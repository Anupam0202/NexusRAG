.PHONY: help install dev test lint docker clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install: ## Install the frontend's dependencies (the gateway's tests need none)
	cd frontend && npm ci --ignore-scripts

dev: ## Run the frontend in development mode; it calls the gateway at NEXT_PUBLIC_API_URL
	cd frontend && npm run dev

test: ## Run the gateway, script and frontend tests
	npm run test:cloudflare
	python3 -m unittest discover -s tests/scripts -p 'test_*.py'
	cd frontend && npm test

lint: ## Lint and type-check the frontend
	cd frontend && npm run lint && npx tsc --noEmit

docker: ## Build and run the optional self-managed frontend image
	docker compose up --build

clean: ## Remove generated files
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	rm -rf frontend/.next frontend/.open-next 2>/dev/null || true
