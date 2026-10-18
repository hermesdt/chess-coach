export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

export class LichessTokenRequiredError extends SyncError {
  constructor() {
    super(
      'Lichess needs a personal access token. Create one at https://lichess.org/account/oauth/token (no scopes needed) and add it in Settings.',
    );
    this.name = 'LichessTokenRequiredError';
  }
}
