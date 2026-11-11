/**
 * @cnd-ide/core-sdk
 *
 * Shared libraries used by VS Code, IntelliJ and Eclipse plugins.
 *
 * Security: Principle of Least Privilege — only projects and services
 * the current identity can use are returned.
 */

export * from './auth';
export * from './services';
export * from './projects';

// Upcoming: ai, harness, observability
