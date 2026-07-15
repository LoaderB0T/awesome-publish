import { describe, expect, test, beforeEach, afterEach } from 'vitest';

describe('Test Suite', () => {
  beforeEach(() => {
    console.log('beforeEach');
  });

  afterEach(() => {
    console.log('afterEach');
  });

  test('Test case', () => {
    console.log('test');
    expect(true).toBe(true);
  });
});
