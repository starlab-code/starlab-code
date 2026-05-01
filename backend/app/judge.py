from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Iterator, List, Optional, Tuple

from .config import settings

if sys.platform != "win32":
    import resource  # type: ignore
else:
    resource = None  # type: ignore


@dataclass
class TestResult:
    index: int
    status: str
    stdout: str = ""
    stderr: str = ""
    expected: str = ""
    actual: str = ""
    runtime_ms: int = 0


_judge_semaphore = threading.BoundedSemaphore(max(1, settings.judge_concurrency))

# Harness script: runs inside the subprocess, handles all test cases for one submission.
# Protocol documented in _run_python_harness_iter below.
_PYTHON_HARNESS_CODE = r"""
import sys
import io
import traceback


def _read_n(stream, n):
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            raise EOFError("unexpected EOF from judge")
        buf += chunk
    return buf


def _exec_one(compiled, input_data):
    import builtins as _builtins
    fake_stdin = io.StringIO(input_data)
    fake_stdout = io.StringIO()
    fake_stderr = io.StringIO()
    saved = (sys.stdin, sys.stdout, sys.stderr)
    sys.stdin = fake_stdin
    sys.stdout = fake_stdout
    sys.stderr = fake_stderr
    status = "ok"
    try:
        exec(compiled, {"__builtins__": _builtins, "__name__": "__main__"})
    except SystemExit:
        pass
    except Exception:
        status = "error"
        sys.stderr.write(traceback.format_exc())
    finally:
        sys.stdin, sys.stdout, sys.stderr = saved
    return fake_stdout.getvalue(), fake_stderr.getvalue(), status


def main():
    ri = sys.stdin.buffer
    ro = sys.stdout.buffer

    sol_path = ri.readline().decode("utf-8").strip()
    with open(sol_path, encoding="utf-8") as f:
        source = f.read()
    compiled = compile(source, "<solution>", "exec")

    while True:
        cmd_line = ri.readline()
        if not cmd_line:
            break
        cmd = cmd_line.decode("utf-8").strip()
        if cmd == "DONE":
            break
        if cmd != "TEST":
            continue

        input_len = int(ri.readline())
        input_data = _read_n(ri, input_len).decode("utf-8", errors="replace")

        out_str, err_str, status = _exec_one(compiled, input_data)

        out_bytes = out_str.encode("utf-8")
        err_bytes = err_str.encode("utf-8")
        ro.write(f"{len(out_bytes)}\n".encode())
        ro.write(out_bytes)
        ro.write(f"{len(err_bytes)}\n".encode())
        ro.write(err_bytes)
        ro.write(f"{status}\n".encode())
        ro.flush()


main()
"""


def _normalize_output(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.strip().splitlines()).strip()


def _python_executable() -> str:
    if sys.platform == "win32":
        return sys.executable
    return shutil.which("python3") or shutil.which("python") or sys.executable


def _subprocess_env() -> dict:
    env = {
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",
        "LANG": "C.UTF-8",
    }
    if sys.platform == "win32":
        for key in ("SYSTEMROOT", "PATH", "TEMP", "TMP", "USERPROFILE", "PATHEXT"):
            value = os.environ.get(key)
            if value is not None:
                env[key] = value
    else:
        env["PATH"] = "/usr/local/bin:/usr/bin:/bin"
    return env


def _apply_posix_limits() -> None:
    """Run inside child (POSIX): cap CPU, memory, file size, and subprocess count."""
    if resource is None:
        return
    cpu = max(1, settings.judge_cpu_seconds)
    mem = max(64 * 1024 * 1024, settings.judge_memory_bytes)
    max_output = max(64 * 1024, settings.judge_max_output_bytes)
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_output * 8, max_output * 8))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    except (ValueError, OSError, AttributeError):
        pass
    os.setsid()


def _apply_posix_limits_harness() -> None:
    """POSIX limits for the harness process (multiple test cases).
    RLIMIT_CPU is intentionally omitted — wall-clock timeout in the parent controls time."""
    if resource is None:
        return
    mem = max(64 * 1024 * 1024, settings.judge_memory_bytes)
    max_output = max(64 * 1024, settings.judge_max_output_bytes)
    try:
        resource.setrlimit(resource.RLIMIT_AS, (mem, mem))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_output * 8, max_output * 8))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
    except (ValueError, OSError, AttributeError):
        pass
    os.setsid()


def _read_capped(stream, cap: int, on_overflow) -> bytes:
    buffer = bytearray()
    try:
        while True:
            chunk = stream.read(4096)
            if not chunk:
                break
            remaining = cap - len(buffer)
            if remaining <= 0:
                on_overflow()
                break
            if len(chunk) > remaining:
                buffer.extend(chunk[:remaining])
                on_overflow()
                break
            buffer.extend(chunk)
    except (ValueError, OSError):
        pass
    return bytes(buffer)


def _build_python_cmd(script_path: Path) -> List[str]:
    cmd = [_python_executable()]
    cmd.extend(["-I", "-B", str(script_path)])
    return cmd


def _gcc_executable() -> str:
    return shutil.which("gcc") or shutil.which("cc") or "gcc"


def _c_compile_env() -> dict:
    if sys.platform == "win32":
        env = {}
        for key in ("SYSTEMROOT", "PATH", "TEMP", "TMP"):
            v = os.environ.get(key)
            if v is not None:
                env[key] = v
        return env
    return {"PATH": "/usr/local/bin:/usr/bin:/bin"}


def _compile_c(source_path: Path, binary_path: Path) -> Tuple[bool, str]:
    """Compile C source with gcc. Returns (success, error_output)."""
    cmd = [
        _gcc_executable(),
        str(source_path),
        "-o", str(binary_path),
        "-O2", "-std=c11", "-lm",
        "-Wall", "-Wextra", "-Wshadow",
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            timeout=30,
            env=_c_compile_env(),
        )
        if result.returncode != 0:
            return False, result.stderr.decode("utf-8", errors="replace")
        return True, ""
    except subprocess.TimeoutExpired:
        return False, "컴파일 시간 초과 (30초)."
    except FileNotFoundError:
        return False, "gcc를 찾을 수 없습니다. 서버에서 C 언어를 지원하지 않습니다."
    except OSError as exc:
        return False, f"컴파일 실패: {exc}"


def _run_single(
    cmd: List[str],
    stdin_text: str,
    timeout: float,
) -> Tuple[int, str, str, int, bool]:
    max_out = max(1024, settings.judge_max_output_bytes)
    popen_kwargs: dict = {
        "stdin": subprocess.PIPE,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "env": _subprocess_env(),
        "cwd": os.path.dirname(cmd[-1]) or None,
    }
    if sys.platform != "win32":
        popen_kwargs["preexec_fn"] = _apply_posix_limits
        popen_kwargs["close_fds"] = True
    else:
        popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

    start = time.perf_counter()
    proc = subprocess.Popen(cmd, **popen_kwargs)

    overflow = {"stdout": False, "stderr": False}

    def kill_quietly() -> None:
        try:
            if sys.platform != "win32":
                os.killpg(proc.pid, 9)
            else:
                proc.kill()
        except (ProcessLookupError, OSError):
            pass

    def mark_stdout_overflow() -> None:
        overflow["stdout"] = True
        kill_quietly()

    def mark_stderr_overflow() -> None:
        overflow["stderr"] = True
        kill_quietly()

    stdout_holder: List[bytes] = [b""]
    stderr_holder: List[bytes] = [b""]

    def reader_stdout() -> None:
        stdout_holder[0] = _read_capped(proc.stdout, max_out, mark_stdout_overflow)

    def reader_stderr() -> None:
        stderr_holder[0] = _read_capped(proc.stderr, max_out, mark_stderr_overflow)

    t_out = threading.Thread(target=reader_stdout, daemon=True)
    t_err = threading.Thread(target=reader_stderr, daemon=True)
    t_out.start()
    t_err.start()

    try:
        if proc.stdin is not None:
            try:
                proc.stdin.write(stdin_text.encode("utf-8"))
            except (BrokenPipeError, OSError):
                pass
            try:
                proc.stdin.close()
            except OSError:
                pass
    except Exception:
        pass

    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        kill_quietly()
        try:
            proc.wait(timeout=1.0)
        except subprocess.TimeoutExpired:
            pass

    t_out.join(timeout=1.5)
    t_err.join(timeout=1.5)

    runtime_ms = int((time.perf_counter() - start) * 1000)

    stdout_text = stdout_holder[0].decode("utf-8", errors="replace")
    stderr_text = stderr_holder[0].decode("utf-8", errors="replace")
    if overflow["stdout"]:
        stdout_text += "\n[output truncated]"
    if overflow["stderr"]:
        stderr_text += "\n[stderr truncated]"

    if timed_out:
        raise subprocess.TimeoutExpired(
            cmd,
            timeout,
            output=stdout_text.encode("utf-8", errors="replace"),
            stderr=stderr_text.encode("utf-8", errors="replace"),
        )

    returncode = proc.returncode if proc.returncode is not None else -1
    return returncode, stdout_text, stderr_text, runtime_ms, overflow["stdout"]


def _read_harness_result(
    proc: subprocess.Popen,
    timeout: float,
) -> Optional[Tuple[str, str, str]]:
    """Read one (out_str, err_str, status_str) from the harness stdout.
    Returns None on timeout, EOF, or parse error."""
    result_holder: List[Optional[Tuple[str, str, str]]] = [None]
    done_event = threading.Event()

    def _reader() -> None:
        try:
            out_len_line = proc.stdout.readline()
            if not out_len_line:
                return
            out_len = int(out_len_line)
            out_bytes = b""
            while len(out_bytes) < out_len:
                chunk = proc.stdout.read(out_len - len(out_bytes))
                if not chunk:
                    return
                out_bytes += chunk

            err_len_line = proc.stdout.readline()
            if not err_len_line:
                return
            err_len = int(err_len_line)
            err_bytes = b""
            while len(err_bytes) < err_len:
                chunk = proc.stdout.read(err_len - len(err_bytes))
                if not chunk:
                    return
                err_bytes += chunk

            status_line = proc.stdout.readline()
            if not status_line:
                return
            status = status_line.decode("utf-8", errors="replace").strip()

            result_holder[0] = (
                out_bytes.decode("utf-8", errors="replace"),
                err_bytes.decode("utf-8", errors="replace"),
                status,
            )
        except (ValueError, OSError):
            pass
        finally:
            done_event.set()

    t = threading.Thread(target=_reader, daemon=True)
    t.start()
    done_event.wait(timeout=timeout)
    return result_holder[0]


def _run_python_harness_iter(
    code: str,
    test_list: list,
    timeout_per_test: float,
) -> Iterator[TestResult]:
    """Run all Python test cases in a single subprocess (harness), reusing the interpreter."""
    with tempfile.TemporaryDirectory(prefix="starlab-code-") as temp_dir:
        solution_path = Path(temp_dir) / "solution.py"
        harness_path = Path(temp_dir) / "_harness.py"
        solution_path.write_text(code, encoding="utf-8")
        harness_path.write_text(_PYTHON_HARNESS_CODE, encoding="utf-8")

        cmd = _build_python_cmd(harness_path)

        popen_kwargs: dict = {
            "stdin": subprocess.PIPE,
            "stdout": subprocess.PIPE,
            "stderr": subprocess.PIPE,
            "env": _subprocess_env(),
        }
        if sys.platform != "win32":
            popen_kwargs["preexec_fn"] = _apply_posix_limits_harness
            popen_kwargs["close_fds"] = True
        else:
            popen_kwargs["creationflags"] = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)

        proc: Optional[subprocess.Popen] = None

        def _start_proc() -> subprocess.Popen:
            p = subprocess.Popen(cmd, **popen_kwargs)
            try:
                p.stdin.write(f"{solution_path}\n".encode())
                p.stdin.flush()
            except OSError:
                pass
            return p

        def _kill_proc(p: subprocess.Popen) -> None:
            try:
                p.kill()
                p.wait(timeout=1.0)
            except Exception:
                pass

        proc = _start_proc()

        try:
            for index, test in enumerate(test_list):
                expected = test.get("expected", "") or ""
                stdin_text = test.get("input", "") or ""

                if len(stdin_text.encode("utf-8")) > settings.judge_max_input_bytes:
                    yield TestResult(
                        index=index,
                        status="runtime_error",
                        expected=expected,
                        stderr="Test input exceeds the configured maximum size.",
                    )
                    continue

                input_bytes = stdin_text.encode("utf-8")

                with _judge_semaphore:
                    try:
                        proc.stdin.write(b"TEST\n")
                        proc.stdin.write(f"{len(input_bytes)}\n".encode())
                        proc.stdin.write(input_bytes)
                        proc.stdin.flush()
                    except OSError:
                        yield TestResult(
                            index=index,
                            status="runtime_error",
                            expected=expected,
                            stderr="Judge process died unexpectedly.",
                        )
                        proc = _start_proc()
                        continue

                    start = time.perf_counter()
                    result = _read_harness_result(proc, timeout_per_test)
                    runtime_ms = int((time.perf_counter() - start) * 1000)

                if result is None:
                    _kill_proc(proc)
                    yield TestResult(
                        index=index,
                        status="time_limit",
                        expected=expected,
                        actual="",
                        runtime_ms=int(timeout_per_test * 1000),
                    )
                    proc = _start_proc() if index + 1 < len(test_list) else None
                else:
                    out_str, err_str, status_str = result
                    if status_str == "error":
                        final_status = "runtime_error"
                    elif _normalize_output(out_str) == _normalize_output(expected):
                        final_status = "passed"
                    else:
                        final_status = "wrong_answer"

                    yield TestResult(
                        index=index,
                        status=final_status,
                        stdout=out_str,
                        stderr=err_str,
                        expected=expected,
                        actual=out_str,
                        runtime_ms=runtime_ms,
                    )
        finally:
            if proc is not None:
                try:
                    proc.stdin.write(b"DONE\n")
                    proc.stdin.close()
                except OSError:
                    pass
                _kill_proc(proc)


def run_code(
    language: str,
    code: str,
    tests: Iterable[dict],
    timeout_per_test: float = 2.0,
) -> List[TestResult]:
    return list(run_code_iter(language=language, code=code, tests=tests, timeout_per_test=timeout_per_test))


def run_code_iter(
    language: str,
    code: str,
    tests: Iterable[dict],
    timeout_per_test: float = 2.0,
) -> Iterator[TestResult]:
    test_list = list(tests)
    lang = language.lower()

    if lang not in ("python", "c"):
        for index in range(len(test_list)):
            yield TestResult(
                index=index,
                status="unsupported_language",
                stderr=f"{language} is not available in this MVP yet.",
            )
        return

    code_bytes = code.encode("utf-8")
    if len(code_bytes) > settings.judge_max_code_bytes:
        for index in range(len(test_list)):
            yield TestResult(
                index=index,
                status="runtime_error",
                stderr=(
                    f"Submitted code is {len(code_bytes)} bytes, which exceeds the "
                    f"{settings.judge_max_code_bytes}-byte limit."
                ),
            )
        return

    if lang == "c":
        yield from _run_code_c_iter(code, test_list, timeout_per_test)
        return

    wrapped_code = textwrap.dedent(code).rstrip() + "\n"
    yield from _run_python_harness_iter(wrapped_code, test_list, timeout_per_test)


def _run_code_c_iter(
    code: str,
    test_list: list,
    timeout_per_test: float,
) -> Iterator[TestResult]:
    with tempfile.TemporaryDirectory(prefix="starlab-code-c-") as temp_dir:
        source_path = Path(temp_dir) / "solution.c"
        binary_path = Path(temp_dir) / ("solution.exe" if sys.platform == "win32" else "solution")
        source_path.write_text(code, encoding="utf-8")

        with _judge_semaphore:
            success, compile_error = _compile_c(source_path, binary_path)

        if not success:
            for index in range(len(test_list)):
                yield TestResult(
                    index=index,
                    status="compile_error",
                    stderr=compile_error,
                )
            return

        cmd = [str(binary_path)]

        for index, test in enumerate(test_list):
            expected = test.get("expected", "") or ""
            stdin_text = test.get("input", "") or ""

            if len(stdin_text.encode("utf-8")) > settings.judge_max_input_bytes:
                yield TestResult(
                    index=index,
                    status="runtime_error",
                    expected=expected,
                    stderr="Test input exceeds the configured maximum size.",
                )
                continue

            with _judge_semaphore:
                try:
                    returncode, stdout, stderr, runtime_ms, _ = _run_single(
                        cmd, stdin_text, timeout_per_test
                    )
                except subprocess.TimeoutExpired as exc:
                    timeout_ms = int(timeout_per_test * 1000)
                    out_text = (exc.output or b"").decode("utf-8", errors="replace") if isinstance(exc.output, (bytes, bytearray)) else (exc.output or "")
                    err_text = (exc.stderr or b"").decode("utf-8", errors="replace") if isinstance(exc.stderr, (bytes, bytearray)) else (exc.stderr or "")
                    yield TestResult(
                        index=index,
                        status="time_limit",
                        stdout=out_text,
                        stderr=(err_text + "\nTime limit exceeded").strip(),
                        expected=expected,
                        actual=out_text,
                        runtime_ms=timeout_ms,
                    )
                    continue

            if returncode != 0:
                status = "runtime_error"
            elif _normalize_output(stdout) == _normalize_output(expected):
                status = "passed"
            else:
                status = "wrong_answer"

            yield TestResult(
                index=index,
                status=status,
                stdout=stdout,
                stderr=stderr,
                expected=expected,
                actual=stdout,
                runtime_ms=runtime_ms,
            )
