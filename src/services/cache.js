const prefix = 'chicken:v2';
export const gameCacheKey = (profileId, gameId) => `${prefix}:${profileId}:game:${gameId}`;
export const gamesIndexKey = profileId => `${prefix}:${profileId}:games`;
export const frequentPlayersKey = profileId => `${prefix}:${profileId}:players`;
export const scoreboardResultKey = profileId => `${prefix}:${profileId}:scoreboard`;
export function readGameCache(profileId, gameId) {
  try { return JSON.parse(localStorage.getItem(gameCacheKey(profileId, gameId)) || 'null'); }
  catch { return null; }
}
export function writeGameCache(profileId, gameId, data) {
  try { localStorage.setItem(gameCacheKey(profileId, gameId), JSON.stringify(data)); return true; }
  catch { return false; }
}
export function removeGameCache(profileId, gameId) {
  try { localStorage.removeItem(gameCacheKey(profileId, gameId)); return true; }
  catch { return false; }
}
