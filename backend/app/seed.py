from __future__ import annotations

from collections import deque
from math import gcd

from sqlmodel import Session, select

from .auth import get_password_hash
from .config import settings
from .models import Assignment, Category, DifficultyLevel, Problem, TestCase, User, UserRole


Case = tuple[str, str, str]


CATEGORY_SEEDS = [
    {"name": "기초 문법", "description": "입출력, 조건문, 반복문처럼 문제 풀이의 가장 기초가 되는 문법 영역입니다."},
    {"name": "수학", "description": "백준의 대표 분류인 수학 태그를 참고한 기본 계산·정수 문제 영역입니다."},
    {"name": "구현", "description": "규칙을 그대로 코드로 옮기는 구현 문제를 연습하는 영역입니다."},
    {"name": "문자열", "description": "백준 문자열 분류를 바탕으로 한 탐색·카운팅 중심 영역입니다."},
    {"name": "배열", "description": "입문 학습 흐름을 위해 따로 묶은 배열 처리 중심 영역입니다."},
    {"name": "정렬", "description": "백준 정렬 분류를 참고한 기본 정렬·순서 비교 영역입니다."},
    {"name": "자료 구조", "description": "백준 자료 구조 분류를 참고한 스택·큐 사고 훈련 영역입니다."},
    {"name": "브루트포스 알고리즘", "description": "백준 브루트포스 분류를 참고한 완전 탐색 입문 영역입니다."},
    {"name": "그래프 탐색", "description": "백준 그래프 탐색 분류를 참고한 BFS/DFS 입문 영역입니다."},
    {"name": "누적 합", "description": "백준 누적 합 분류를 참고한 구간 계산 기초 영역입니다."},
]


def spec(
    title: str,
    short_description: str,
    statement: str,
    input_description: str,
    output_description: str,
    constraints: str,
    category_name: str,
    difficulty: DifficultyLevel,
    starter_code_python: str,
    testcases: list[Case],
):
    return {
        "title": title,
        "short_description": short_description,
        "statement": statement,
        "input_description": input_description,
        "output_description": output_description,
        "constraints": constraints,
        "category_name": category_name,
        "difficulty": difficulty,
        "starter_code_python": starter_code_python,
        "testcases": testcases,
    }


def seed_initial_data(session: Session) -> None:
    primary_teacher = ensure_primary_teacher(session)
    backfill_user_hierarchy(session, primary_teacher)
    categories = ensure_categories(session)
    if settings.seed_demo_data and not session.exec(select(Problem)).first():
        seed_problem_catalog(session, categories, primary_teacher)
    session.commit()
    return

    teacher = User(
        username="teacher_demo",
        display_name="데모 강사",
        hashed_password=get_password_hash("demo1234"),
        role=UserRole.teacher,
    )
    session.add(teacher)
    session.flush()

    for problem_spec in build_problem_specs():
        cases = problem_spec["testcases"]
        if len(cases) != 50:
            raise ValueError(f"{problem_spec['title']} testcases must be exactly 50")

        problem = Problem(
            title=problem_spec["title"],
            short_description=problem_spec["short_description"],
            statement=problem_spec["statement"],
            input_description=problem_spec["input_description"],
            output_description=problem_spec["output_description"],
            constraints=problem_spec["constraints"],
            category_id=categories[problem_spec["category_name"]].id,
            difficulty=problem_spec["difficulty"],
            starter_code_python=problem_spec["starter_code_python"],
            sample_input=cases[0][0],
            sample_output=cases[0][1],
            created_by=teacher.id,
        )
        session.add(problem)
        session.flush()

        for index, (input_data, expected_output, note) in enumerate(cases):
            session.add(
                TestCase(
                    problem_id=problem.id,
                    input_data=input_data,
                    expected_output=expected_output,
                    is_public=index < 3,
                    note=note,
                )
            )

    session.commit()

def ensure_primary_teacher(session: Session) -> User:
    teacher = session.exec(select(User).where(User.username == settings.primary_teacher_username)).first()
    if teacher and teacher.role != UserRole.teacher:
        raise ValueError(f"Primary teacher username '{settings.primary_teacher_username}' is already used by a student")

    if not teacher:
        teacher = User(
            username=settings.primary_teacher_username,
            display_name=settings.primary_teacher_display_name,
            hashed_password=get_password_hash(settings.primary_teacher_password),
            role=UserRole.teacher,
            is_primary_teacher=True,
        )
        session.add(teacher)
        session.flush()

    teacher.display_name = teacher.display_name or settings.primary_teacher_display_name
    teacher.role = UserRole.teacher
    teacher.is_primary_teacher = True
    teacher.primary_teacher_id = teacher.id
    teacher.created_by_teacher_id = None
    session.add(teacher)
    session.flush()
    return teacher


def backfill_user_hierarchy(session: Session, primary_teacher: User) -> None:
    teachers = session.exec(select(User).where(User.role == UserRole.teacher)).all()
    for teacher in teachers:
        if teacher.id == primary_teacher.id:
            teacher.is_primary_teacher = True
            teacher.primary_teacher_id = teacher.id
            teacher.created_by_teacher_id = None
        else:
            if teacher.primary_teacher_id is None:
                teacher.primary_teacher_id = primary_teacher.id
            if teacher.created_by_teacher_id is None:
                teacher.created_by_teacher_id = primary_teacher.id
        session.add(teacher)

    assignments = session.exec(select(Assignment).order_by(Assignment.created_at)).all()
    creator_by_student_id: dict[int, int] = {}
    for assignment in assignments:
        creator_by_student_id.setdefault(assignment.student_id, assignment.teacher_id)

    students = session.exec(select(User).where(User.role == UserRole.student)).all()
    for student in students:
        creator_id = student.created_by_teacher_id or creator_by_student_id.get(student.id) or primary_teacher.id
        creator = session.get(User, creator_id) if creator_id else None
        if not creator or creator.role != UserRole.teacher:
            creator = primary_teacher
        student.created_by_teacher_id = creator.id
        student.primary_teacher_id = creator.primary_teacher_id or creator.id
        session.add(student)

    session.flush()


def ensure_categories(session: Session) -> dict[str, Category]:
    categories = {category.name: category for category in session.exec(select(Category)).all()}
    for row in CATEGORY_SEEDS:
        if row["name"] in categories:
            continue
        category = Category(**row)
        session.add(category)
        session.flush()
        categories[category.name] = category
    return categories


def seed_problem_catalog(session: Session, categories: dict[str, Category], teacher: User) -> None:
    for problem_spec in build_problem_specs():
        cases = problem_spec["testcases"]
        if len(cases) != 50:
            raise ValueError(f"{problem_spec['title']} testcases must be exactly 50")

        problem = Problem(
            title=problem_spec["title"],
            short_description=problem_spec["short_description"],
            statement=problem_spec["statement"],
            input_description=problem_spec["input_description"],
            output_description=problem_spec["output_description"],
            constraints=problem_spec["constraints"],
            category_id=categories[problem_spec["category_name"]].id,
            difficulty=problem_spec["difficulty"],
            starter_code_python=problem_spec["starter_code_python"],
            sample_input=cases[0][0],
            sample_output=cases[0][1],
            created_by=teacher.id,
        )
        session.add(problem)
        session.flush()

        for index, (input_data, expected_output, note) in enumerate(cases):
            session.add(
                TestCase(
                    problem_id=problem.id,
                    input_data=input_data,
                    expected_output=expected_output,
                    is_public=index < 3,
                    note=note,
                )
            )


def build_problem_specs():
    return (
        basic_problem_specs()
        + math_problem_specs()
        + implementation_problem_specs()
        + string_problem_specs()
        + array_problem_specs()
        + sorting_problem_specs()
        + data_structure_problem_specs()
        + bruteforce_problem_specs()
        + graph_problem_specs()
        + prefix_problem_specs()
    )


def basic_problem_specs():
    return [
        spec("세 수의 합", "세 정수의 합을 구하세요.", "a, b, c가 주어집니다. 합을 출력하세요.", "한 줄에 a b c", "합 출력", "-1000 <= 값 <= 1000", "기초 문법", DifficultyLevel.beginner, "a, b, c = map(int, input().split())\n", make_sum_cases()),
        spec("두 수 비교", "두 정수의 크기를 비교하세요.", "A와 B를 비교해 >, <, == 중 하나를 출력하세요.", "한 줄에 A B", "비교 결과 출력", "-1000 <= A, B <= 1000", "기초 문법", DifficultyLevel.beginner, "a, b = map(int, input().split())\n", make_compare_cases()),
        spec("곱셈표 한 칸", "N x K 값을 출력하세요.", "N과 K가 주어집니다. N x K를 출력하세요.", "한 줄에 N K", "곱 출력", "1 <= N, K <= 19", "기초 문법", DifficultyLevel.beginner, "n, k = map(int, input().split())\n", make_multiplication_cases()),
        spec("별 직사각형", "별 직사각형을 출력하세요.", "N행 M열의 별 직사각형을 출력하세요.", "한 줄에 N M", "직사각형 출력", "1 <= N, M <= 6", "기초 문법", DifficultyLevel.beginner, "n, m = map(int, input().split())\n", make_rectangle_cases()),
        spec("Even or Odd", "짝수인지 홀수인지 출력하세요.", "정수 N이 주어집니다. 짝수면 EVEN, 홀수면 ODD를 출력하세요.", "한 줄에 N", "EVEN 또는 ODD", "-100000 <= N <= 100000", "기초 문법", DifficultyLevel.beginner, "n = int(input())\n", make_even_odd_cases()),
    ]


def math_problem_specs():
    return [
        spec("약수의 개수", "약수 개수를 구하세요.", "자연수 N의 약수 개수를 출력하세요.", "한 줄에 N", "약수 개수 출력", "1 <= N <= 100000", "수학", DifficultyLevel.basic, "n = int(input())\n", make_divisor_cases()),
        spec("소수 판별", "소수 여부를 판별하세요.", "N이 소수면 YES, 아니면 NO를 출력하세요.", "한 줄에 N", "YES 또는 NO", "1 <= N <= 100000", "수학", DifficultyLevel.basic, "n = int(input())\n", make_prime_cases()),
        spec("최대공약수와 최소공배수", "gcd와 lcm을 구하세요.", "A, B의 최대공약수와 최소공배수를 출력하세요.", "한 줄에 A B", "gcd와 lcm", "1 <= A, B <= 10000", "수학", DifficultyLevel.basic, "a, b = map(int, input().split())\n", make_gcd_lcm_cases()),
        spec("숫자 문자열 자리수 합", "각 자리 숫자의 합을 구하세요.", "숫자 문자열의 각 자리 합을 출력하세요.", "한 줄에 숫자 문자열", "합 출력", "1 <= 길이 <= 20", "수학", DifficultyLevel.beginner, "s = input().strip()\n", make_digit_sum_cases()),
        spec("Divisor Sum", "약수의 합을 구하세요.", "자연수 N의 모든 약수의 합을 출력하세요.", "한 줄에 N", "약수 합 출력", "1 <= N <= 100000", "수학", DifficultyLevel.basic, "n = int(input())\n", make_divisor_sum_cases()),
    ]


def implementation_problem_specs():
    return [
        spec("전자레인지 시계", "T분 뒤 시각을 구하세요.", "현재 시각과 T분이 주어집니다. T분 뒤 시각을 출력하세요.", "첫 줄 H M, 둘째 줄 T", "H M 출력", "0 <= H < 24", "구현", DifficultyLevel.beginner, "h, m = map(int, input().split())\nt = int(input())\n", make_clock_cases()),
        spec("영수증 확인", "총액이 맞는지 확인하세요.", "물건 가격과 개수 합이 총액과 같으면 YES를 출력하세요.", "총액, 물건 수, 각 가격/개수", "YES 또는 NO", "1 <= N <= 6", "구현", DifficultyLevel.beginner, "total = int(input())\nn = int(input())\n", make_receipt_cases()),
        spec("격자 이동", "격자 이동 후 위치를 구하세요.", "N x N 격자에서 이동 후 최종 위치를 출력하세요.", "N, 다음 줄에 이동 명령", "행 열 출력", "2 <= N <= 8", "구현", DifficultyLevel.basic, "n = int(input())\nmoves = input().split()\n", make_grid_move_cases()),
        spec("주사위 세 개", "상금을 계산하세요.", "세 주사위 눈에 따른 상금을 출력하세요.", "한 줄에 세 눈", "상금 출력", "1 <= 눈 <= 6", "구현", DifficultyLevel.beginner, "a, b, c = map(int, input().split())\n", make_dice_reward_cases()),
        spec("Grade Card", "점수에 맞는 학점을 출력하세요.", "정수 점수가 주어집니다. 90 이상 A, 80 이상 B, 70 이상 C, 60 이상 D, 나머지는 F를 출력하세요.", "한 줄에 score", "학점 출력", "0 <= score <= 100", "구현", DifficultyLevel.beginner, "score = int(input())\n", make_grade_cases()),
    ]


def string_problem_specs():
    return [
        spec("모음 개수 세기", "모음 개수를 세세요.", "문자열 안의 모음 개수를 출력하세요.", "한 줄에 문자열", "개수 출력", "1 <= 길이 <= 100", "문자열", DifficultyLevel.beginner, "s = input().strip()\n", make_vowel_cases()),
        spec("회문 판별", "회문 여부를 판별하세요.", "문자열이 회문이면 YES, 아니면 NO를 출력하세요.", "한 줄에 문자열", "YES 또는 NO", "1 <= 길이 <= 50", "문자열", DifficultyLevel.beginner, "s = input().strip()\n", make_palindrome_cases()),
        spec("특정 문자 개수", "문자 개수를 세세요.", "문자열 S 안에서 문자 C가 몇 번 등장하는지 출력하세요.", "S, 다음 줄에 C", "개수 출력", "1 <= 길이 <= 100", "문자열", DifficultyLevel.beginner, "s = input().strip()\ntarget = input().strip()\n", make_char_count_cases()),
        spec("단어 뒤집기", "각 단어를 뒤집어 출력하세요.", "단어 순서는 유지하고 각 단어만 뒤집어 출력하세요.", "한 줄에 여러 단어", "뒤집힌 문장 출력", "단어 수 2개 이상", "문자열", DifficultyLevel.basic, "words = input().split()\n", make_reverse_words_cases()),
        spec("Word Count", "문장 속 단어 수를 세세요.", "한 줄 문장이 주어집니다. 공백으로 구분된 단어 개수를 출력하세요.", "한 줄에 문장", "단어 수 출력", "1 <= 길이 <= 200", "문자열", DifficultyLevel.beginner, "line = input().strip()\n", make_word_count_cases()),
    ]


def array_problem_specs():
    return [
        spec("최댓값과 위치", "최댓값과 위치를 찾으세요.", "배열의 최댓값과 첫 위치를 출력하세요.", "N, 다음 줄에 배열", "최댓값과 위치", "1 <= N <= 100", "배열", DifficultyLevel.beginner, "n = int(input())\narr = list(map(int, input().split()))\n", make_array_max_cases()),
        spec("구간 뒤집기", "배열 일부를 뒤집으세요.", "L~R 구간을 뒤집은 배열을 출력하세요.", "N, 배열, L R", "배열 출력", "1 <= N <= 8", "배열", DifficultyLevel.basic, "n = int(input())\narr = list(map(int, input().split()))\nl, r = map(int, input().split())\n", make_reverse_subarray_cases()),
        spec("점수 평균", "평균을 소수 둘째 자리까지 출력하세요.", "점수들의 평균을 출력하세요.", "N, 다음 줄에 점수", "평균 출력", "1 <= N <= 10", "배열", DifficultyLevel.beginner, "n = int(input())\nscores = list(map(int, input().split()))\n", make_average_cases()),
        spec("배열 왼쪽 회전", "배열을 K칸 회전하세요.", "배열을 왼쪽으로 K칸 회전한 결과를 출력하세요.", "N, 배열, K", "회전한 배열", "1 <= N <= 8", "배열", DifficultyLevel.basic, "n = int(input())\narr = list(map(int, input().split()))\nk = int(input())\n", make_rotation_cases()),
        spec("Second Largest", "두 번째로 큰 값을 찾으세요.", "서로 다른 정수 배열이 주어집니다. 두 번째로 큰 값을 출력하세요.", "N, 다음 줄에 배열", "두 번째 최댓값", "2 <= N <= 8", "배열", DifficultyLevel.basic, "n = int(input())\narr = list(map(int, input().split()))\n", make_second_largest_cases()),
    ]


def make_sum_cases() -> list[Case]:
    cases = []
    for i in range(50):
        a = i - 20
        b = i * 2 - 17
        c = (i % 7) * 5 - 12
        cases.append((f"{a} {b} {c}", str(a + b + c), f"합 계산 #{i + 1}"))
    return cases


def compare_symbol(a: int, b: int) -> str:
    if a > b:
        return ">"
    if a < b:
        return "<"
    return "=="


def make_compare_cases() -> list[Case]:
    cases = []
    for i in range(50):
        a = (i * 5) % 31 - 15
        b = (i * 7) % 31 - 15
        if i % 10 == 0:
            b = a
        cases.append((f"{a} {b}", compare_symbol(a, b), f"비교 #{i + 1}"))
    return cases


def make_multiplication_cases() -> list[Case]:
    return [(f"{i % 9 + 2} {(i * 3) % 8 + 2}", str((i % 9 + 2) * ((i * 3) % 8 + 2)), f"곱셈 #{i + 1}") for i in range(50)]


def make_rectangle_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = i % 5 + 1
        m = (i * 2) % 6 + 1
        cases.append((f"{n} {m}", "\n".join("*" * m for _ in range(n)), f"직사각형 #{i + 1}"))
    return cases


def divisor_count(n: int) -> int:
    count = 0
    x = 1
    while x * x <= n:
        if n % x == 0:
            count += 1 if x * x == n else 2
        x += 1
    return count


def make_divisor_cases() -> list[Case]:
    values = [1, 2, 3, 4, 6, 8, 9, 10, 12, 16]
    values.extend(i * ((i % 7) + 1) for i in range(11, 51))
    return [(str(n), str(divisor_count(n)), f"약수 #{idx + 1}") for idx, n in enumerate(values[:50])]


def is_prime(n: int) -> bool:
    if n < 2:
        return False
    x = 2
    while x * x <= n:
        if n % x == 0:
            return False
        x += 1
    return True


def make_prime_cases() -> list[Case]:
    return [(str(number), "YES" if is_prime(number) else "NO", f"소수 #{number}") for number in range(1, 51)]


def make_gcd_lcm_cases() -> list[Case]:
    cases = []
    for i in range(50):
        a = (i + 2) * (i % 5 + 1)
        b = (i * 7) % 53 + 1
        g = gcd(a, b)
        cases.append((f"{a} {b}", f"{g}\n{a * b // g}", f"gcd/lcm #{i + 1}"))
    return cases


def make_digit_sum_cases() -> list[Case]:
    cases = []
    for i in range(50):
        text = f"{i * 137 + 2468}"
        cases.append((text, str(sum(int(ch) for ch in text)), f"자리수 합 #{i + 1}"))
    return cases


def make_clock_cases() -> list[Case]:
    cases = []
    for i in range(50):
        h = (i * 7) % 24
        m = (i * 13) % 60
        t = (i * 37 + 25) % 500
        total = h * 60 + m + t
        cases.append((f"{h} {m}\n{t}", f"{(total // 60) % 24} {total % 60}", f"시계 #{i + 1}"))
    return cases


def make_receipt_cases() -> list[Case]:
    cases = []
    for i in range(50):
        items = []
        total = 0
        for j in range(3):
            price = 400 + i * 17 + j * 90
            count = (i + j) % 3 + 1
            total += price * count
            items.append((price, count))
        shown = total if i % 4 else total + 1
        input_data = "\n".join([str(shown), "3", *[f"{price} {count}" for price, count in items]])
        cases.append((input_data, "YES" if shown == total else "NO", f"영수증 #{i + 1}"))
    return cases


def move_on_grid(size: int, moves: list[str]) -> tuple[int, int]:
    x, y = 1, 1
    delta = {"L": (0, -1), "R": (0, 1), "U": (-1, 0), "D": (1, 0)}
    for move in moves:
        dx, dy = delta[move]
        nx, ny = x + dx, y + dy
        if 1 <= nx <= size and 1 <= ny <= size:
            x, y = nx, ny
    return x, y


def make_grid_move_cases() -> list[Case]:
    pattern = ["R", "D", "L", "U", "R", "R", "D", "L"]
    cases = []
    for i in range(50):
        size = i % 5 + 4
        moves = [pattern[(i + step) % len(pattern)] for step in range(i % 6 + 4)]
        x, y = move_on_grid(size, moves)
        cases.append((f"{size}\n{' '.join(moves)}", f"{x} {y}", f"격자 #{i + 1}"))
    return cases


def dice_reward(a: int, b: int, c: int) -> int:
    if a == b == c:
        return 10000 + a * 1000
    if a == b or a == c:
        return 1000 + a * 100
    if b == c:
        return 1000 + b * 100
    return max(a, b, c) * 100


def make_dice_reward_cases() -> list[Case]:
    return [(f"{i % 6 + 1} {(i * 2) % 6 + 1} {(i * 3) % 6 + 1}", str(dice_reward(i % 6 + 1, (i * 2) % 6 + 1, (i * 3) % 6 + 1)), f"주사위 #{i + 1}") for i in range(50)]


def make_vowel_cases() -> list[Case]:
    parts_a = ["academy", "string", "queue", "banana", "python", "coding", "orange", "input", "output", "solver"]
    parts_b = ["lab", "class", "note", "robot", "alpha"]
    vowels = set("aeiou")
    cases = []
    for i in range(50):
        word = parts_a[i % len(parts_a)] + parts_b[i % len(parts_b)] + ("ae" if i % 3 == 0 else "io" if i % 4 == 0 else "")
        cases.append((word, str(sum(ch in vowels for ch in word)), f"모음 #{i + 1}"))
    return cases


def make_palindrome_cases() -> list[Case]:
    cases = []
    for i in range(25):
        half = f"ab{i % 10}c"
        word = half + half[::-1]
        cases.append((word, "YES", f"회문 #{i + 1}"))
    for i in range(25):
        word = f"code{i}lab"
        cases.append((word, "NO", f"비회문 #{i + 26}"))
    return cases


def make_char_count_cases() -> list[Case]:
    words = ["banana", "algorithm", "mississippi", "queue", "abracadabra", "codingtest"]
    targets = ["a", "i", "s", "u", "b", "t"]
    cases = []
    for i in range(50):
        word = words[i % len(words)] + ("a" * (i % 3))
        target = targets[i % len(targets)]
        cases.append((f"{word}\n{target}", str(word.count(target)), f"문자 세기 #{i + 1}"))
    return cases


def make_reverse_words_cases() -> list[Case]:
    groups = [
        ["hello", "world"],
        ["starlab", "code", "class"],
        ["python", "is", "fun"],
        ["data", "structure", "queue"],
        ["graph", "search", "bfs"],
    ]
    cases = []
    for i in range(50):
        words = groups[i % len(groups)] + ([f"n{i % 7}"] if i % 2 else [])
        source = " ".join(words)
        target = " ".join(word[::-1] for word in words)
        cases.append((source, target, f"단어 뒤집기 #{i + 1}"))
    return cases


def make_array_max_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        arr = [((i * 11 + j * 7) % 41) - 20 for j in range(n)]
        arr[(i * 3) % n] = 50 + i
        best = max(arr)
        cases.append((f"{n}\n{' '.join(map(str, arr))}", f"{best}\n{arr.index(best) + 1}", f"최댓값 #{i + 1}"))
    return cases


def make_reverse_subarray_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        arr = [j + i for j in range(1, n + 1)]
        left = i % n
        right = min(n - 1, left + (i % 3) + 1)
        next_arr = arr[:]
        next_arr[left:right + 1] = reversed(next_arr[left:right + 1])
        cases.append((f"{n}\n{' '.join(map(str, arr))}\n{left + 1} {right + 1}", " ".join(map(str, next_arr)), f"뒤집기 #{i + 1}"))
    return cases


def make_average_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 4 + (i % 4)
        scores = [50 + ((i * 9 + j * 11) % 51) for j in range(n)]
        cases.append((f"{n}\n{' '.join(map(str, scores))}", f"{sum(scores) / n:.2f}", f"평균 #{i + 1}"))
    return cases


def make_rotation_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        arr = [((i + 1) * 3 + j) for j in range(n)]
        k = (i * 2 + 1) % n
        cases.append((f"{n}\n{' '.join(map(str, arr))}\n{k}", " ".join(map(str, arr[k:] + arr[:k])), f"회전 #{i + 1}"))
    return cases


def sorting_problem_specs():
    return [
        spec("세 수 정렬", "세 정수를 오름차순 정렬하세요.", "세 정수를 오름차순으로 출력하세요.", "한 줄에 세 정수", "정렬 결과", "-1000 <= 값 <= 1000", "정렬", DifficultyLevel.beginner, "nums = list(map(int, input().split()))\n", make_sort_three_cases()),
        spec("좌표 정렬", "좌표를 x, y 순으로 정렬하세요.", "x 오름차순, 같으면 y 오름차순으로 정렬하세요.", "N, 다음 N줄에 x y", "정렬된 좌표", "1 <= N <= 6", "정렬", DifficultyLevel.basic, "n = int(input())\npoints = [tuple(map(int, input().split())) for _ in range(n)]\n", make_coordinate_sort_cases()),
        spec("단어 정렬", "단어를 길이와 사전순으로 정렬하세요.", "길이 오름차순, 길이가 같으면 사전순으로 정렬하세요.", "N, 다음 N줄에 단어", "정렬된 단어", "1 <= N <= 6", "정렬", DifficultyLevel.basic, "n = int(input())\nwords = [input().strip() for _ in range(n)]\n", make_word_sort_cases()),
        spec("성적 순 정렬", "점수 내림차순으로 이름을 정렬하세요.", "점수가 높은 순, 같으면 이름 사전순으로 출력하세요.", "N, 다음 N줄에 이름 점수", "정렬된 이름", "1 <= N <= 6", "정렬", DifficultyLevel.basic, "n = int(input())\nrows = [input().split() for _ in range(n)]\n", make_rank_sort_cases()),
        spec("Absolute Sort", "절댓값 기준으로 정렬하세요.", "절댓값이 작은 수부터 정렬하고, 절댓값이 같으면 실제 값이 작은 수를 먼저 출력하세요.", "N, 다음 줄에 정수들", "정렬된 결과", "1 <= N <= 8", "정렬", DifficultyLevel.basic, "n = int(input())\nnums = list(map(int, input().split()))\n", make_abs_sort_cases()),
    ]


def data_structure_problem_specs():
    return [
        spec("괄호 검사기", "올바른 괄호 문자열인지 판별하세요.", "올바른 괄호 문자열이면 YES, 아니면 NO를 출력하세요.", "한 줄에 괄호 문자열", "YES 또는 NO", "1 <= 길이 <= 200", "자료 구조", DifficultyLevel.basic, "s = input().strip()\n", make_parentheses_cases()),
        spec("스택 명령 처리", "스택 명령을 처리하세요.", "push X, pop, top 명령 결과를 출력하세요.", "Q, 다음 Q줄에 명령", "필요한 결과 출력", "1 <= Q <= 8", "자료 구조", DifficultyLevel.basic, "q = int(input())\n", make_stack_command_cases()),
        spec("큐 명령 처리", "큐 명령을 처리하세요.", "push X, pop, front 명령 결과를 출력하세요.", "Q, 다음 Q줄에 명령", "필요한 결과 출력", "1 <= Q <= 8", "자료 구조", DifficultyLevel.basic, "q = int(input())\n", make_queue_command_cases()),
        spec("괄호 최대 깊이", "괄호 최대 깊이를 구하세요.", "올바르지 않으면 -1, 맞다면 최대 깊이를 출력하세요.", "한 줄에 괄호 문자열", "정답 출력", "1 <= 길이 <= 200", "자료 구조", DifficultyLevel.basic, "s = input().strip()\n", make_parentheses_depth_cases()),
        spec("Bracket Balance", "여러 종류의 괄호 균형을 검사하세요.", "문자열에 포함된 (), [], {} 가 모두 올바르게 짝지어졌으면 YES, 아니면 NO를 출력하세요.", "한 줄에 문자열", "YES 또는 NO", "1 <= 길이 <= 200", "자료 구조", DifficultyLevel.basic, "s = input().strip()\n", make_bracket_balance_cases()),
    ]


def bruteforce_problem_specs():
    return [
        spec("블랙잭 미니", "세 장의 카드로 최대 합을 구하세요.", "세 장을 골라 합이 M 이하이면서 가장 큰 값을 출력하세요.", "N M, 다음 줄에 카드", "최대 합", "3 <= N <= 20", "브루트포스 알고리즘", DifficultyLevel.basic, "n, m = map(int, input().split())\nnums = list(map(int, input().split()))\n", make_blackjack_cases()),
        spec("분해합 찾기", "가장 작은 생성자를 찾으세요.", "N의 가장 작은 생성자를 출력하고 없으면 0을 출력하세요.", "한 줄에 N", "생성자 출력", "1 <= N <= 5000", "브루트포스 알고리즘", DifficultyLevel.basic, "n = int(input())\n", make_decomposition_cases()),
        spec("아홉 난쟁이 미니", "일곱 수의 합이 100이 되게 하세요.", "아홉 수 중 일곱 개를 골라 합이 100이 되도록 출력하세요.", "아홉 줄에 수", "일곱 수 오름차순", "항상 답 존재", "브루트포스 알고리즘", DifficultyLevel.basic, "# 조합을 확인해 보세요.\n", make_seven_dwarfs_cases()),
        spec("두 수 합 최대", "합이 제한 이하인 두 수의 최대합을 구하세요.", "서로 다른 두 수의 합 중 M 이하 최대값을 출력하세요.", "N M, 다음 줄에 배열", "최대 합", "2 <= N <= 10", "브루트포스 알고리즘", DifficultyLevel.basic, "n, m = map(int, input().split())\nnums = list(map(int, input().split()))\n", make_pair_under_target_cases()),
        spec("Subset Sum Check", "부분집합 합 존재 여부를 판별하세요.", "배열에서 몇 개를 골라 합이 target이 될 수 있으면 YES, 아니면 NO를 출력하세요.", "N target, 다음 줄에 배열", "YES 또는 NO", "1 <= N <= 8", "브루트포스 알고리즘", DifficultyLevel.basic, "n, target = map(int, input().split())\nnums = list(map(int, input().split()))\n", make_subset_sum_cases()),
    ]


def graph_problem_specs():
    return [
        spec("도달 가능한 정점 수", "시작점에서 도달 가능한 정점 수를 세세요.", "시작 정점에서 방문 가능한 정점 개수를 출력하세요.", "N M S, 다음 줄들에 간선", "정점 개수", "1 <= N <= 20", "그래프 탐색", DifficultyLevel.intermediate, "n, m, s = map(int, input().split())\n", make_graph_cases()),
        spec("미로 최단거리", "격자 최단거리를 구하세요.", "1인 칸으로만 이동해 (1,1)에서 (N,M)까지 최단거리를 구하세요.", "N M, 다음 N줄에 격자", "최단거리", "2 <= N, M <= 6", "그래프 탐색", DifficultyLevel.intermediate, "n, m = map(int, input().split())\ngrid = [input().strip() for _ in range(n)]\n", make_grid_shortest_cases()),
        spec("섬의 개수", "연결된 섬 개수를 구하세요.", "상하좌우로 연결된 1 덩어리 개수를 출력하세요.", "N M, 다음 N줄에 격자", "섬 개수", "2 <= N, M <= 6", "그래프 탐색", DifficultyLevel.intermediate, "n, m = map(int, input().split())\ngrid = [input().strip() for _ in range(n)]\n", make_island_count_cases()),
        spec("경로 존재 여부", "두 정점 사이 경로 존재를 판단하세요.", "A에서 B로 갈 수 있으면 YES, 아니면 NO를 출력하세요.", "N M, 간선들, 마지막 줄 A B", "YES 또는 NO", "1 <= N <= 12", "그래프 탐색", DifficultyLevel.basic, "n, m = map(int, input().split())\n", make_path_query_cases()),
        spec("Shortest Distance Query", "두 정점 사이 최단 거리를 구하세요.", "무방향 그래프에서 A에서 B까지의 최단 간선 수를 출력하세요. 갈 수 없으면 -1을 출력하세요.", "N M, 간선들, 마지막 줄 A B", "최단 거리", "1 <= N <= 12", "그래프 탐색", DifficultyLevel.intermediate, "n, m = map(int, input().split())\n", make_graph_distance_cases()),
    ]


def prefix_problem_specs():
    return [
        spec("구간 합 질의 1", "구간 합을 빠르게 구하세요.", "여러 구간 [l, r] 합을 차례대로 출력하세요.", "N Q, 배열, 질의들", "각 질의의 답", "1 <= N <= 1000", "누적 합", DifficultyLevel.basic, "n, q = map(int, input().split())\narr = list(map(int, input().split()))\n", make_prefix_sum_cases()),
        spec("최대 길이 K 구간 합", "길이 K 구간의 최대합을 구하세요.", "길이가 K인 연속 부분 배열 합의 최댓값을 출력하세요.", "N K, 다음 줄에 배열", "최대합", "2 <= K <= N <= 20", "누적 합", DifficultyLevel.basic, "n, k = map(int, input().split())\narr = list(map(int, input().split()))\n", make_best_k_sum_cases()),
        spec("짝수 개수 질의", "구간의 짝수 개수를 구하세요.", "각 구간에 포함된 짝수 개수를 출력하세요.", "N Q, 배열, 질의들", "각 질의의 답", "1 <= N <= 20", "누적 합", DifficultyLevel.basic, "n, q = map(int, input().split())\narr = list(map(int, input().split()))\n", make_even_query_cases()),
        spec("문자 개수 구간 질의", "문자열 구간에서 문자 개수를 세세요.", "각 질의마다 문자 C가 구간에 몇 번 나오는지 출력하세요.", "문자열, Q, 다음 Q줄에 C l r", "각 질의의 답", "0 <= l <= r < |S|", "누적 합", DifficultyLevel.basic, "s = input().strip()\nq = int(input())\n", make_char_prefix_cases()),
        spec("Range Average Query", "구간 평균을 빠르게 구하세요.", "각 구간 [l, r]의 평균을 소수 둘째 자리까지 출력하세요.", "N Q, 배열, 질의들", "각 질의의 평균", "1 <= N <= 1000", "누적 합", DifficultyLevel.basic, "n, q = map(int, input().split())\narr = list(map(int, input().split()))\n", make_range_average_cases()),
    ]


def make_sort_three_cases() -> list[Case]:
    cases = []
    for i in range(50):
        nums = [i * 3 - 22, 17 - i, (i % 9) * 4 - 12]
        cases.append((f"{nums[0]} {nums[1]} {nums[2]}", " ".join(map(str, sorted(nums))), f"세 수 정렬 #{i + 1}"))
    return cases


def make_coordinate_sort_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 4 + (i % 3)
        points = [(((i * 5 + j * 3) % 11) - 5, ((i * 7 + j * 2) % 11) - 5) for j in range(n)]
        ordered = sorted(points)
        cases.append(("\n".join([str(n), *[f"{x} {y}" for x, y in points]]), "\n".join(f"{x} {y}" for x, y in ordered), f"좌표 정렬 #{i + 1}"))
    return cases


def make_word_sort_cases() -> list[Case]:
    pools = [["sun", "moon", "star", "code"], ["aa", "bbb", "c", "dddd", "ee"], ["graph", "tree", "set", "map", "list"], ["python", "java", "go", "rust"]]
    cases = []
    for i in range(50):
        words = list(dict.fromkeys(pools[i % len(pools)] + [f"w{i % 10}"]))
        ordered = sorted(words, key=lambda word: (len(word), word))
        cases.append(("\n".join([str(len(words)), *words]), "\n".join(ordered), f"단어 정렬 #{i + 1}"))
    return cases


def make_rank_sort_cases() -> list[Case]:
    names = ["mina", "jun", "sora", "doho", "yuna", "tae"]
    cases = []
    for i in range(50):
        n = 4 + (i % 3)
        rows = [(names[j], 50 + ((i * 13 + j * 17) % 51)) for j in range(n)]
        ordered = sorted(rows, key=lambda item: (-item[1], item[0]))
        cases.append(("\n".join([str(n), *[f"{name} {score}" for name, score in rows]]), "\n".join(name for name, _ in ordered), f"성적 정렬 #{i + 1}"))
    return cases


def is_valid_parentheses(text: str) -> bool:
    balance = 0
    for char in text:
        balance += 1 if char == "(" else -1
        if balance < 0:
            return False
    return balance == 0


def make_parentheses_cases() -> list[Case]:
    cases = []
    for i in range(25):
        left = (i % 4) + 1
        text = "(" * left + "()" * (i % 3) + ")" * left
        cases.append((text, "YES", f"올바른 괄호 #{i + 1}"))
    for i in range(25):
        left = (i % 5) + 1
        text = "(" * left + ")" * max(0, left - 1)
        text = text + "(" if i % 2 == 0 else ")(" + text
        cases.append((text, "YES" if is_valid_parentheses(text) else "NO", f"괄호 검사 #{i + 26}"))
    return cases


def run_stack_commands(commands: list[str]) -> str:
    stack: list[str] = []
    output: list[str] = []
    for command in commands:
        if command.startswith("push"):
            stack.append(command.split()[1])
        elif command == "pop":
            output.append(stack.pop() if stack else "EMPTY")
        elif command == "top":
            output.append(stack[-1] if stack else "EMPTY")
    return "\n".join(output)


def make_stack_command_cases() -> list[Case]:
    cases = []
    for i in range(50):
        commands = [f"push {i + 1}", f"push {i + 3}", "top", "pop", "top"]
        if i % 3 == 0:
            commands.extend(["pop", "pop"])
        else:
            commands.extend([f"push {i + 10}", "top"])
        cases.append(("\n".join([str(len(commands)), *commands]), run_stack_commands(commands), f"스택 #{i + 1}"))
    return cases


def run_queue_commands(commands: list[str]) -> str:
    queue: deque[str] = deque()
    output: list[str] = []
    for command in commands:
        if command.startswith("push"):
            queue.append(command.split()[1])
        elif command == "pop":
            output.append(queue.popleft() if queue else "EMPTY")
        elif command == "front":
            output.append(queue[0] if queue else "EMPTY")
    return "\n".join(output)


def make_queue_command_cases() -> list[Case]:
    cases = []
    for i in range(50):
        commands = [f"push {i + 2}", f"push {i + 5}", "front", "pop", "front"]
        if i % 4 == 0:
            commands.extend(["pop", "front"])
        else:
            commands.extend([f"push {i + 11}", "front"])
        cases.append(("\n".join([str(len(commands)), *commands]), run_queue_commands(commands), f"큐 #{i + 1}"))
    return cases


def parentheses_depth(text: str) -> int:
    depth = 0
    best = 0
    for char in text:
        if char == "(":
            depth += 1
            best = max(best, depth)
        else:
            depth -= 1
        if depth < 0:
            return -1
    return best if depth == 0 else -1


def make_parentheses_depth_cases() -> list[Case]:
    cases = []
    for i in range(50):
        text = "(" * ((i % 4) + 1) + "()" * (i % 3) + ")" * ((i % 4) + 1) if i % 2 == 0 else "(" * ((i % 4) + 1) + ")" * (i % 2)
        cases.append((text, str(parentheses_depth(text)), f"깊이 #{i + 1}"))
    return cases


def best_blackjack(cards: list[int], limit: int) -> int:
    best = 0
    for i in range(len(cards)):
        for j in range(i + 1, len(cards)):
            for k in range(j + 1, len(cards)):
                total = cards[i] + cards[j] + cards[k]
                if best < total <= limit:
                    best = total
    return best


def make_blackjack_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        cards = [((i * 7 + j * 11) % 30) + 1 for j in range(n)]
        limit = sum(cards[:3]) + (i % 12)
        cases.append((f"{n} {limit}\n{' '.join(map(str, cards))}", str(best_blackjack(cards, limit)), f"블랙잭 #{i + 1}"))
    return cases


def decomposition_generator(n: int) -> int:
    start = max(1, n - len(str(n)) * 9)
    for value in range(start, n):
        if value + sum(map(int, str(value))) == n:
            return value
    return 0


def make_decomposition_cases() -> list[Case]:
    return [(str(40 + i * 37), str(decomposition_generator(40 + i * 37)), f"분해합 #{i + 1}") for i in range(50)]


def make_seven_dwarfs_cases() -> list[Case]:
    cases = []
    for i in range(50):
        base = [7, 8, 10, 13, 19, 20, 23]
        shifted = [value + (i % 3) for value in base]
        shifted[-1] -= sum(shifted) - 100
        values = shifted + [120 + i, 140 + i]
        cases.append(("\n".join(map(str, values)), "\n".join(map(str, sorted(shifted))), f"난쟁이 #{i + 1}"))
    return cases


def best_pair_under_target(numbers: list[int], limit: int) -> int:
    best = 0
    for i in range(len(numbers)):
        for j in range(i + 1, len(numbers)):
            total = numbers[i] + numbers[j]
            if best < total <= limit:
                best = total
    return best


def make_pair_under_target_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        values = [((i * 9 + j * 7) % 35) + 1 for j in range(n)]
        limit = 15 + (i % 20)
        cases.append((f"{n} {limit}\n{' '.join(map(str, values))}", str(best_pair_under_target(values, limit)), f"쌍 합 #{i + 1}"))
    return cases


def reachable_vertices(n: int, edges: list[tuple[int, int]], start: int) -> int:
    graph = {node: [] for node in range(1, n + 1)}
    for u, v in edges:
        graph[u].append(v)
        graph[v].append(u)
    visited = {start}
    queue = deque([start])
    while queue:
        node = queue.popleft()
        for nxt in graph[node]:
            if nxt in visited:
                continue
            visited.add(nxt)
            queue.append(nxt)
    return len(visited)


def make_graph_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        start = (i % n) + 1
        edges = [(node, node + 1) for node in range(1, n) if (node + i) % 2 == 0]
        if n >= 4 and i % 3 == 0:
            edges.append((1, 3))
        if n >= 5 and i % 4 == 0:
            edges.append((2, 5))
        input_data = f"{n} {len(edges)} {start}"
        if edges:
            input_data += "\n" + "\n".join(f"{u} {v}" for u, v in edges)
        cases.append((input_data, str(reachable_vertices(n, edges, start)), f"도달 정점 #{i + 1}"))
    return cases


def shortest_grid_path(grid: list[str]) -> int:
    n = len(grid)
    m = len(grid[0])
    if grid[0][0] == "0" or grid[-1][-1] == "0":
        return -1
    queue = deque([(0, 0, 1)])
    visited = {(0, 0)}
    while queue:
        x, y, dist = queue.popleft()
        if (x, y) == (n - 1, m - 1):
            return dist
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if not (0 <= nx < n and 0 <= ny < m):
                continue
            if grid[nx][ny] == "0" or (nx, ny) in visited:
                continue
            visited.add((nx, ny))
            queue.append((nx, ny, dist + 1))
    return -1


def make_grid_shortest_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 4 + (i % 2)
        m = 4 + ((i + 1) % 2)
        rows = []
        for x in range(n):
            line = []
            for y in range(m):
                if (x, y) in {(0, 0), (n - 1, m - 1)}:
                    line.append("1")
                elif (x + y + i) % 5 == 0:
                    line.append("0")
                else:
                    line.append("1")
            rows.append("".join(line))
        cases.append((f"{n} {m}\n" + "\n".join(rows), str(shortest_grid_path(rows)), f"미로 #{i + 1}"))
    return cases


def island_count(grid: list[str]) -> int:
    n = len(grid)
    m = len(grid[0])
    visited = set()
    islands = 0
    for x in range(n):
        for y in range(m):
            if grid[x][y] == "0" or (x, y) in visited:
                continue
            islands += 1
            queue = deque([(x, y)])
            visited.add((x, y))
            while queue:
                cx, cy = queue.popleft()
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = cx + dx, cy + dy
                    if not (0 <= nx < n and 0 <= ny < m):
                        continue
                    if grid[nx][ny] == "0" or (nx, ny) in visited:
                        continue
                    visited.add((nx, ny))
                    queue.append((nx, ny))
    return islands


def make_island_count_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 4 + (i % 2)
        m = 5
        rows = []
        for x in range(n):
            rows.append("".join("1" if (x * 3 + y + i) % 4 == 0 else "0" for y in range(m)))
        cases.append((f"{n} {m}\n" + "\n".join(rows), str(island_count(rows)), f"섬 #{i + 1}"))
    return cases


def has_path(n: int, edges: list[tuple[int, int]], start: int, goal: int) -> bool:
    graph = {node: [] for node in range(1, n + 1)}
    for u, v in edges:
        graph[u].append(v)
        graph[v].append(u)
    queue = deque([start])
    visited = {start}
    while queue:
        node = queue.popleft()
        if node == goal:
            return True
        for nxt in graph[node]:
            if nxt in visited:
                continue
            visited.add(nxt)
            queue.append(nxt)
    return False


def make_path_query_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 3)
        edges = [(node, node + 1) for node in range(1, n) if (node + i) % 2 == 0]
        if i % 3 == 0 and n >= 5:
            edges.append((1, 5))
        start = (i % n) + 1
        goal = ((i * 2) % n) + 1
        cases.append(("\n".join([f"{n} {len(edges)}", *[f"{u} {v}" for u, v in edges], f"{start} {goal}"]), "YES" if has_path(n, edges, start, goal) else "NO", f"경로 #{i + 1}"))
    return cases


def make_prefix_sum_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 6 + (i % 5)
        q = 3 + (i % 3)
        arr = [((i * 5 + j * 3) % 21) - 10 for j in range(n)]
        queries = []
        answers = []
        for j in range(q):
            left = (j * 2 + i) % n + 1
            right = left + (i + j) % (n - left + 1)
            queries.append((left, right))
            answers.append(str(sum(arr[left - 1:right])))
        cases.append((f"{n} {q}\n{' '.join(map(str, arr))}\n" + "\n".join(f"{l} {r}" for l, r in queries), "\n".join(answers), f"구간 합 #{i + 1}"))
    return cases


def make_best_k_sum_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 7 + (i % 4)
        k = 2 + (i % 3)
        arr = [((i * 11 + j * 5) % 25) - 8 for j in range(n)]
        best = max(sum(arr[start:start + k]) for start in range(n - k + 1))
        cases.append((f"{n} {k}\n{' '.join(map(str, arr))}", str(best), f"최대 구간 #{i + 1}"))
    return cases


def make_even_query_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 7 + (i % 4)
        q = 3 + (i % 3)
        arr = [((i * 7 + j * 4) % 20) - 5 for j in range(n)]
        queries = []
        answers = []
        for j in range(q):
            left = (i + j) % n + 1
            right = left + (j + 1) % (n - left + 1)
            queries.append((left, right))
            answers.append(str(sum(1 for value in arr[left - 1:right] if value % 2 == 0)))
        cases.append((f"{n} {q}\n{' '.join(map(str, arr))}\n" + "\n".join(f"{l} {r}" for l, r in queries), "\n".join(answers), f"짝수 질의 #{i + 1}"))
    return cases


def make_char_prefix_cases() -> list[Case]:
    alphabet = ["a", "b", "c", "d"]
    cases = []
    for i in range(50):
        text = "".join(alphabet[(i + j * 2) % len(alphabet)] for j in range(10 + (i % 3)))
        q = 3 + (i % 2)
        queries = []
        answers = []
        for j in range(q):
            char = alphabet[(i + j) % len(alphabet)]
            left = (j * 2 + i) % len(text)
            right = left + (i + j) % (len(text) - left)
            queries.append((char, left, right))
            answers.append(str(text[left:right + 1].count(char)))
        cases.append(("\n".join([text, str(q), *[f"{char} {left} {right}" for char, left, right in queries]]), "\n".join(answers), f"문자 질의 #{i + 1}"))
    return cases


def make_even_odd_cases() -> list[Case]:
    cases = []
    for i in range(50):
        value = i * 9 - 101
        cases.append((str(value), "EVEN" if value % 2 == 0 else "ODD", f"짝홀 #{i + 1}"))
    return cases


def divisor_sum(n: int) -> int:
    total = 0
    x = 1
    while x * x <= n:
        if n % x == 0:
            total += x
            if x * x != n:
                total += n // x
        x += 1
    return total


def make_divisor_sum_cases() -> list[Case]:
    values = [1, 2, 3, 4, 6, 8, 9, 12, 18, 24]
    values.extend(30 + i * 17 for i in range(40))
    return [(str(n), str(divisor_sum(n)), f"약수 합 #{idx + 1}") for idx, n in enumerate(values[:50])]


def grade_letter(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 70:
        return "C"
    if score >= 60:
        return "D"
    return "F"


def make_grade_cases() -> list[Case]:
    return [(str((i * 11) % 101), grade_letter((i * 11) % 101), f"학점 #{i + 1}") for i in range(50)]


def make_word_count_cases() -> list[Case]:
    chunks = [
        ["starlab", "code"],
        ["this", "is", "fun"],
        ["python", "class", "room", "one"],
        ["solve", "more", "problems"],
        ["keep", "going"],
    ]
    cases = []
    for i in range(50):
        words = chunks[i % len(chunks)] + ([f"n{i % 5}"] if i % 2 == 0 else [])
        sentence = " ".join(words)
        cases.append((sentence, str(len(sentence.split())), f"단어 수 #{i + 1}"))
    return cases


def second_largest(values: list[int]) -> int:
    return sorted(values)[-2]


def make_second_largest_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 3)
        values = [i * 4 + j * 3 - 20 for j in range(n)]
        cases.append((f"{n}\n{' '.join(map(str, values))}", str(second_largest(values)), f"두 번째 최댓값 #{i + 1}"))
    return cases


def make_abs_sort_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        values = [((i * 7 + j * 5) % 19) - 9 for j in range(n)]
        ordered = sorted(values, key=lambda value: (abs(value), value))
        cases.append((f"{n}\n{' '.join(map(str, values))}", " ".join(map(str, ordered)), f"절댓값 정렬 #{i + 1}"))
    return cases


def is_balanced_brackets(text: str) -> bool:
    pairs = {")": "(", "]": "[", "}": "{"}
    opens = set(pairs.values())
    stack: list[str] = []
    for char in text:
        if char in opens:
            stack.append(char)
        elif char in pairs:
            if not stack or stack[-1] != pairs[char]:
                return False
            stack.pop()
    return not stack


def make_bracket_balance_cases() -> list[Case]:
    cases = []
    valid_samples = ["([])", "{[()]}", "(()[]){}", "[{()}]", "{[]()}"]
    invalid_samples = ["([)]", "(()", "{[}]", "][", "({})]"]
    for i in range(25):
        text = valid_samples[i % len(valid_samples)] + ("()" if i % 2 == 0 else "")
        cases.append((text, "YES", f"균형 괄호 #{i + 1}"))
    for i in range(25):
        text = invalid_samples[i % len(invalid_samples)] + ("[" if i % 2 == 0 else "")
        cases.append((text, "YES" if is_balanced_brackets(text) else "NO", f"불균형 괄호 #{i + 26}"))
    return cases


def subset_sum_exists(numbers: list[int], target: int) -> bool:
    n = len(numbers)
    for mask in range(1 << n):
        total = 0
        for idx in range(n):
            if mask & (1 << idx):
                total += numbers[idx]
        if total == target:
            return True
    return False


def make_subset_sum_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 3)
        numbers = [((i * 5 + j * 4) % 12) + 1 for j in range(n)]
        target = sum(numbers[:2]) if i % 2 == 0 else sum(numbers) + 3
        answer = "YES" if subset_sum_exists(numbers, target) else "NO"
        cases.append((f"{n} {target}\n{' '.join(map(str, numbers))}", answer, f"부분집합 #{i + 1}"))
    return cases


def shortest_graph_distance(n: int, edges: list[tuple[int, int]], start: int, goal: int) -> int:
    graph = {node: [] for node in range(1, n + 1)}
    for u, v in edges:
        graph[u].append(v)
        graph[v].append(u)
    queue = deque([(start, 0)])
    visited = {start}
    while queue:
        node, dist = queue.popleft()
        if node == goal:
            return dist
        for nxt in graph[node]:
            if nxt in visited:
                continue
            visited.add(nxt)
            queue.append((nxt, dist + 1))
    return -1


def make_graph_distance_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 5 + (i % 4)
        edges = [(node, node + 1) for node in range(1, n)]
        if i % 3 == 0 and n >= 5:
            edges.append((1, 4))
        if i % 4 == 0 and n >= 6:
            edges.append((2, 6))
        start = (i % n) + 1
        goal = ((i * 2 + 1) % n) + 1
        answer = shortest_graph_distance(n, edges, start, goal)
        cases.append(("\n".join([f"{n} {len(edges)}", *[f"{u} {v}" for u, v in edges], f"{start} {goal}"]), str(answer), f"최단 거리 #{i + 1}"))
    return cases


def make_range_average_cases() -> list[Case]:
    cases = []
    for i in range(50):
        n = 6 + (i % 4)
        q = 3 + (i % 3)
        arr = [((i * 4 + j * 7) % 31) - 10 for j in range(n)]
        queries = []
        answers = []
        for j in range(q):
            left = (i + j) % n + 1
            right = left + (j + i) % (n - left + 1)
            queries.append((left, right))
            values = arr[left - 1:right]
            answers.append(f"{sum(values) / len(values):.2f}")
        cases.append((f"{n} {q}\n{' '.join(map(str, arr))}\n" + "\n".join(f"{left} {right}" for left, right in queries), "\n".join(answers), f"구간 평균 #{i + 1}"))
    return cases
