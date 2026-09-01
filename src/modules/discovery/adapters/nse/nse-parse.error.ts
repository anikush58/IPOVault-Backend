export class NseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NseParseError';
  }
}
