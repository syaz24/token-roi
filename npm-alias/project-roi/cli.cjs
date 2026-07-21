#!/usr/bin/env node
'use strict';

/**
 * `npx project-roi` -> the real launcher in the `token-roi` package.
 *
 * npx resolves a PACKAGE name, not a bin alias inside another package, so this
 * thin package exists purely so both spellings work. It adds no behaviour.
 */
require('token-roi/bin/token-roi.cjs');
