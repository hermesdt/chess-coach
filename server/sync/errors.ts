export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}
