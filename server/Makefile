.PHONY: install dev db-create db-migrate db-revision run test lint clean

PYTHON := python3
UVICORN := uvicorn
ALEMBIC := alembic
PYTEST := pytest

install:
	pip install -r requirements.txt

dev:
	$(UVICORN) app.main:app --reload --host 0.0.0.0 --port 8000

db-create:
	@echo "请在 PostgreSQL 中手动创建数据库: CREATE DATABASE safebox;"

db-revision:
	$(ALEMBIC) revision --autogenerate -m "auto"

db-migrate:
	$(ALEMBIC) upgrade head

db-downgrade:
	$(ALEMBIC) downgrade -1

test:
	$(PYTEST) tests/ -v

lint:
	ruff check app/ tests/

clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete
