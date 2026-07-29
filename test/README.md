# Reelmint Test Suite

## Running Tests

### Run all tests
```bash
npm test
```

### Run tests in watch mode
```bash
npm run test:watch
```

### Run with coverage
```bash
npm run test:coverage
```

## Test Structure

- **auth.test.js** - Authentication, tokenization, password hashing
- **ai.test.js** - AI module status and configuration
- **billing.test.js** - Stripe integration and billing configuration
- **images.test.js** - Image provider detection and fallbacks
- **store.test.js** - Database backend selection (Postgres vs File)
- **integration.test.js** - Cross-module integration and environment handling

## Notes

- Tests use Node's built-in test runner (no external dependencies)
- All tests are isolated and can run in any order
- Optional services (Stripe, Anthropic) don't block test execution
- Tests verify graceful degradation when services are unconfigured
