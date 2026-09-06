export type Phase = "ht" | "ft";
export type Role = "GK" | "CB" | "FB" | "PIVOT" | "MID" | "WING" | "ST";

export type Player = {
  id: string;
  providerId?: number | null;
  name: string;
  short: string;
  number: number | null;
  role: Role;
  roleLabel: string;
  x?: number;
  y?: number;
  starter: boolean;
  played: boolean;
  minute?: number | null;
  photoUrl?: string | null;
};

export type Team = {
  id?: string;
  providerId?: number | null;
  name: string;
  shortName: string;
  logoUrl?: string | null;
};

export type MatchEvent = {
  id: string;
  playerId: string | null;
  assistPlayerId: string | null;
  type: string;
  detail: string | null;
  minute: number | null;
  extraMinute: number | null;
  period: "first" | "second" | "extra" | "shootout" | "unknown";
};

export type MatchData = {
  id: string;
  providerId?: number | null;
  competition: string;
  date: string;
  kickoff: string;
  venue?: string | null;
  status: string;
  statusShort: string;
  home: Team;
  away: Team;
  homeScore: number | null;
  awayScore: number | null;
  halftimeHomeScore?: number | null;
  halftimeAwayScore?: number | null;
  events?: MatchEvent[];
  eventsAvailable?: boolean;
  formation: string;
  players: Player[];
  source: "demo" | "cloud";
  lastSyncedAt?: string | null;
};

export type PlayerRating = {
  overall: number | null;
  attributes: Record<string, number | null>;
  updatedAt?: string;
  convertedFromFive?: boolean;
};

export type PhaseRatings = Record<string, PlayerRating>;
export type RatingsState = Record<Phase, PhaseRatings>;

export type CommunityRating = {
  player_id: string;
  phase: Phase;
  vote_count: number;
  overall_average: number | null;
  attribute_averages: Record<string, number>;
};
