/**
 * Minimal push-based async iterable used to bridge WebSocket messages into
 * `for await` streams. Supports completion, failure and consumer cancellation.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: { resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void }[] = [];
  private finished = false;
  private failure: unknown = undefined;
  private failed = false;

  constructor(private readonly onCancel?: () => void) {}

  push(item: T) {
    if (this.finished) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value: item, done: false });
    else this.items.push(item);
  }

  end() {
    if (this.finished) return;
    this.finished = true;
    for (const w of this.waiters.splice(0)) w.resolve({ value: undefined, done: true });
  }

  fail(error: unknown) {
    if (this.finished) return;
    this.finished = true;
    this.failed = true;
    this.failure = error;
    for (const w of this.waiters.splice(0)) w.reject(error);
  }

  get closed() {
    return this.finished;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false });
        if (this.failed) return Promise.reject(this.failure);
        if (this.finished) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
      },
      return: () => {
        if (!this.finished) {
          this.finished = true;
          this.onCancel?.();
        }
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}
