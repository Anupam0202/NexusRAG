.PHONY: help install dev backend frontend docker test lint clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install all dependencies
	cd backend && pip install -e ".[dev]"
	cd frontend && npm install

dev: ## Run both backend and frontend in dev mode
	@echo "Starting backend..."
	cd backend && uvicorn main:app --reload --port 8000 &
	@echo "Starting frontend..."
	cd frontend && npm run dev &
	@echo "Backend: http://localhost:8000"
	@echo "Frontend: http://localhost:3000"

backend: ## Run backend only
	cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

frontend: ## Run frontend only
	cd frontend && npm run dev

docker: ## Build and run with Docker Compose
	docker compose up --build

test: ## Run backend tests
	cd backend && pytest -v --cov=src --cov-report=term-missing

lint: ## Lint and format
	cd backend && ruff check src/ --fix && black src/

clean: ## Clean generated files
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	rm -rf backend/data/vector_store 2>/dev/null || true
	rm -rf frontend/.next 2>/dev/null || true