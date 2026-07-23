export interface AppUser {
  email: string;
  full_name: string | null;
  role: string;
}

export interface ParticipantRecord {
  id: string;
  email: string;
  display_name: string;
  team_key: string;
  team_name: string;
  mentor_key: string;
  phone?: string;
  linkedin?: string;
  custom_fields?: Record<string, string>;
  checked_in: boolean;
  checked_in_at?: string;
  active?: boolean;
  is_exception?: boolean;
  access_key?: string;
  access_version?: number;
  access_enabled?: boolean;
  access_expires_at?: string;
  access_email_status?: "unsent" | "pending" | "accepted" | "failed" | "unknown";
  access_email_accepted_at?: string;
  portal_first_seen_at?: string;
  portal_last_seen_at?: string;
  promo_claimed_at?: string;
  selected_photo_ids?: string[];
}

export interface ParticipantPhoto {
  id: string;
  name: string;
  mimeType: string;
  thumbnailUrl: string;
  viewUrl: string;
  createdAt: string;
  width?: number;
  height?: number;
}

export interface ParticipantPhotosPageData {
  photos: ParticipantPhoto[];
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  selectedPhotoIds: string[];
  matchedPhotoIds: string[];
  claimedClusterKeys: string[];
  photosFolderLink: string | null;
  sourceFolderLink: string;
}

export interface PersonClusterSummary {
  clusterKey: string;
  faceCount: number;
  photoCount: number;
  coverThumbnailUrl: string;
  coverBox: number[];
  coverAspect: number;
  claimed: boolean;
}

export interface ParticipantPeopleData {
  people: PersonClusterSummary[];
  claimedClusterKeys: string[];
}

export interface MentorRecord {
  id: string;
  mentor_key: string;
  display_name: string;
  email?: string;
  phone?: string;
  details?: string;
  linkedin?: string;
  invited_at?: string;
}

export interface JudgeRecord {
  id: string;
  judge_key: string;
  display_name: string;
  email?: string;
  phone?: string;
  details?: string;
  linkedin?: string;
}

export interface JudgeGroupRecord {
  id: string;
  group_key: string;
  name: string;
  details?: string;
  mentor_keys?: string[];
  judge_keys?: string[];
  team_keys?: string[];
}

export interface TeamInfoRecord {
  id: string;
  team_key: string;
  table_number?: string;
  note?: string;
}

export interface EventSettingsRecord {
  id: string;
  event_name: string;
  event_url?: string;
  wifi_network?: string;
  wifi_password?: string;
  wifi_network_secondary?: string;
  wifi_password_secondary?: string;
  event_details?: string;
  agenda?: string;
  questions_and_answers?: string;
  promo_instructions?: string;
  partner_coupon_code?: string;
  partner_registration_url?: string;
}

export interface PromoCodeRecord {
  id: string;
  code: string;
  codex_credit_url?: string;
  api_credit_url?: string;
  api_credit_code?: string;
  assigned_email: string;
  assigned_at?: string;
  blocked?: boolean;
}

export interface MentorPortalData {
  mentor: { displayName: string; email: string | null };
  teams: Array<{
    teamKey: string;
    teamName: string;
    members: Array<{ displayName: string; checkedIn: boolean }>;
  }>;
}

export interface PortalData {
  participant: {
    displayName: string;
    email: string;
    teamName: string;
    checkedIn: boolean;
    checkedInAt: string | null;
  };
  teamTable: { tableNumber: string; note: string } | null;
  teamMembers: Array<{ displayName: string; isCurrentUser: boolean; checkedIn: boolean; phone: string | null; linkedin: string | null }>;
  mentor: {
    displayName: string;
    email: string | null;
    phone: string | null;
    details: string | null;
    linkedin: string | null;
  } | null;
  settings: {
    eventName: string;
    eventUrl: string;
    wifiNetwork: string;
    wifiPassword: string;
    wifiNetworkSecondary: string;
    wifiPasswordSecondary: string;
    eventDetails: string;
    agenda: string;
    questionsAndAnswers: string;
    promoInstructions: string;
    partnerCouponCode?: string;
    partnerRegistrationUrl?: string;
  } | null;
  promoLinks: {
    codexCredits: string | null;
    apiCredits: string | null;
  };
  mcpToken?: string | null;
}
