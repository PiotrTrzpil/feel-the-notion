# Typecheck / lint + bundle check
check:
    npm run lint
    npm run build

# Alias for check
lint:
    npm run lint

# Unit tests
test:
    npm test

# Production build
build:
    npm run build

# Watch mode
dev:
    npm run dev

# Everything before a commit
verify: check test

# Build and install into the Obsidian vault (OBSIDIAN_VAULT in repo .env)
install:
    nu ../new-mac-setup/user/obsidian_feel_the_notion.nu
