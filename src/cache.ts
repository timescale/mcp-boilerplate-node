interface CacheProps<T> {
  contents?: T;
  fetch: () => Promise<T[]>;
  ttl?: number; // amount of time in milliseconds after which cached data will be considered stale
}

export class Cache<T> {
  private contents: Promise<T[]> | null = null;
  private fetch: CacheProps<T>['fetch'];
  private expirationDateTime?: number;

  constructor({ fetch, ttl }: CacheProps<T>) {
    this.fetch = fetch;

    if (ttl) {
      this.expirationDateTime = Date.now() + ttl;
    }
  }

  async get(): Promise<T[]> {
    if (this.expirationDateTime && Date.now() > this.expirationDateTime) {
      this.contents = null;
    }
    this.contents ??= this.fetch();

    return this.contents;
  }

  async find(predicate: (item: T) => boolean): Promise<T | null> {
    const items = await this.get();
    return items.find(predicate) ?? null;
  }

  async filter(predicate: (item: T) => boolean): Promise<T[]> {
    const items = await this.get();
    return items.filter(predicate);
  }
}
