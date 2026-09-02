export class NseFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NseFetchError';
  }
}
