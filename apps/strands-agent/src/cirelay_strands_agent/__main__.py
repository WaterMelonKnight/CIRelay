"""Command-line demo entrypoint."""

import argparse

from .agent import create_agent


def main() -> None:
    parser = argparse.ArgumentParser(description="Investigate CI with CIRelay")
    parser.add_argument("request", help="developer CI investigation request")
    args = parser.parse_args()
    print(create_agent()(args.request))


if __name__ == "__main__":
    main()
