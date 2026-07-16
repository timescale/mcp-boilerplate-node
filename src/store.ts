interface StoreProps<T> {
  fetch: () => Promise<T>;
  ttl?: number; // amount of time in milliseconds after which cached data will be considered stale
}

export class Store<T> {
  private contents: Promise<T> | null = null;
  private fetch: StoreProps<T>['fetch'];
  private ttl?: number;
  private expirationDateTime?: number;

  constructor({ fetch, ttl }: StoreProps<T>) {
    this.fetch = fetch;
    this.ttl = ttl;
  }

  async get(): Promise<T> {
    if (this.expirationDateTime && Date.now() > this.expirationDateTime) {
      this.contents = null;
      this.expirationDateTime = undefined;
    }
    this.contents ??= this.fetch();

    if (this.ttl && !this.expirationDateTime) {
      this.expirationDateTime = Date.now() + this.ttl;
    }

    return this.contents;
  }

  set(value: T): void {
    this.contents = Promise.resolve(value);
    if (this.ttl) {
      this.expirationDateTime = Date.now() + this.ttl;
    }
  }
}

interface ArrayStoreProps<T> {
  fetch: () => Promise<T[]>;
  ttl?: number;
}

export class ArrayStore<T> extends Store<T[]> {
  constructor({ fetch, ttl }: ArrayStoreProps<T>) {
    super({ fetch, ttl });
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
