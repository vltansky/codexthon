export class CsvValidationError extends Error {}

export interface ParticipantImportRow {
  email: string;
  displayName: string;
  teamKey: string;
  teamName: string;
  mentorKey: string;
  mentorName: string;
  mentorEmail: string;
  mentorPhone: string;
  mentorDetails: string;
}

export interface MentorTeamImportRow {
  teamKey: string;
  teamName: string;
  mentorKey: string;
  mentorName: string;
  mentorDetails: string;
  memberNames: string[];
}

export interface CheckInImportRow {
  email: string;
  checkedIn: boolean;
}

export interface PromoBundleImportRow {
  codexCreditUrl: string;
  apiCreditValue: string;
}

interface PromoAllocationImport {
  creditType: "api" | "codex";
  values: string[];
}

const emailHeaders = new Set(["email", "email_address"]);
const nameHeaders = new Set(["name", "guest_name", "full_name"]);
const participantApprovalStatusHeaders = new Set(["approval_status"]);
const checkInStatusHeaders = new Set([
  "check_in_status",
  "checked_in",
  "is_checked_in",
]);
const teamHeaders = new Set(["team", "team_name", "group", "group_name"]);
const lumaTeamHeaders = new Set(["who_are_you_applying_with"]);
const teamKeyHeaders = new Set(["team_key", "team_id", "group_id"]);
const mentorNameHeaders = new Set(["mentor", "mentor_name"]);
const mentorKeyHeaders = new Set(["mentor_key", "mentor_id"]);
const mentorEmailHeaders = new Set(["mentor_email", "mentor_email_address"]);
const mentorPhoneHeaders = new Set(["mentor_phone", "mentor_phone_number"]);
const mentorDetailsHeaders = new Set(["mentor_details", "mentor_bio", "mentor_notes"]);
const codexCreditHeaders = new Set(["codex_credits", "codex_credit", "codex_credit_url", "codex_promo_link"]);
const apiCreditHeaders = new Set(["api_token_credits", "api_credits", "api_credit_url", "api_promo_link"]);
const allocationCreditTypeHeaders = new Set(["credit_type"]);
const allocationValueHeaders = new Set(["assigned_code_or_url"]);

export function parsePromoBundleCsv(csv: string): PromoBundleImportRow[] {
  const { headers, rows } = parseCsv(csv);
  const codexCreditIndex = findHeader(headers, codexCreditHeaders);
  const apiCreditIndex = findHeader(headers, apiCreditHeaders);
  if (codexCreditIndex === -1 || apiCreditIndex === -1) {
    throw new CsvValidationError(`promo CSV needs Codex Credits and API Token Credits columns; found: ${headers.join(", ")}`);
  }

  const bundles = rows.map((row, index) => {
    const codexCreditUrl = normalizeCodexCredit(valueAt(row, codexCreditIndex));
    const apiCreditValue = valueAt(row, apiCreditIndex);
    if (!isHttpUrl(codexCreditUrl) || !isPromoValue(apiCreditValue)) {
      throw new CsvValidationError(`invalid promo CSV row ${index + 2}`);
    }
    return { codexCreditUrl, apiCreditValue } satisfies PromoBundleImportRow;
  });

  assertUnique(bundles.map(({ codexCreditUrl }) => codexCreditUrl), "Codex credit link");
  assertUnique(bundles.map(({ apiCreditValue }) => apiCreditValue), "API credit");
  return bundles;
}

export function parsePromoFiles(csvFiles: string[]): PromoBundleImportRow[] {
  if (csvFiles.length === 1) {
    const { headers } = parseCsv(csvFiles[0]!);
    if (findHeader(headers, allocationCreditTypeHeaders) !== -1) {
      const allocation = parsePromoAllocationCsv(csvFiles[0]!);
      return allocation.values.map((value) => allocation.creditType === "codex"
        ? { codexCreditUrl: value, apiCreditValue: "" }
        : { codexCreditUrl: "", apiCreditValue: value });
    }
    return parsePromoBundleCsv(csvFiles[0]!);
  }
  if (csvFiles.length !== 2) {
    throw new CsvValidationError("select one paired promo CSV or both allocation CSVs");
  }

  const allocations = csvFiles.map(parsePromoAllocationCsv);
  const api = allocations.find(({ creditType }) => creditType === "api");
  const codex = allocations.find(({ creditType }) => creditType === "codex");
  if (!api || !codex) {
    throw new CsvValidationError("select one API allocation CSV and one Codex Credits allocation CSV");
  }
  if (api.values.length !== codex.values.length) {
    throw new CsvValidationError("API and Codex allocation CSVs must contain the same number of rows");
  }

  return codex.values.map((codexCreditUrl, index) => ({
    codexCreditUrl,
    apiCreditValue: api.values[index]!,
  }));
}

function parsePromoAllocationCsv(csv: string): PromoAllocationImport {
  const { headers, rows } = parseCsv(csv);
  const creditTypeIndex = findHeader(headers, allocationCreditTypeHeaders);
  const valueIndex = findHeader(headers, allocationValueHeaders);
  if (creditTypeIndex === -1 || valueIndex === -1) {
    throw new CsvValidationError(`allocation CSV needs credit_type and assigned_code_or_url columns; found: ${headers.join(", ")}`);
  }

  const creditTypes = new Set(rows.map((row) => valueAt(row, creditTypeIndex).toLowerCase()));
  const creditType = creditTypes.size === 1 && creditTypes.has("api")
    ? "api"
    : creditTypes.size === 1 && creditTypes.has("codex credits")
      ? "codex"
      : null;
  if (!creditType) {
    throw new CsvValidationError("allocation CSV must contain only API or only CODEX CREDITS rows");
  }

  const values = rows.map((row, index) => {
    const rawValue = valueAt(row, valueIndex);
    const value = creditType === "codex" ? normalizeCodexCredit(rawValue) : rawValue;
    if (creditType === "codex" ? !isHttpUrl(value) : !isPromoValue(value)) {
      throw new CsvValidationError(`invalid ${creditType} allocation CSV row ${index + 2}`);
    }
    return value;
  });
  assertUnique(values, creditType === "codex" ? "Codex credit link" : "API credit");
  return { creditType, values };
}

export function parseParticipantCsv(csv: string): ParticipantImportRow[] {
  const { headers, rows } = parseCsv(csv);
  const emailIndex = findHeader(headers, emailHeaders);
  const nameIndex = findHeader(headers, nameHeaders);
  const teamIndex = findHeader(headers, teamHeaders);
  const lumaTeamIndex = findHeader(headers, lumaTeamHeaders);
  const teamKeyIndex = findHeader(headers, teamKeyHeaders);
  const mentorNameIndex = findHeader(headers, mentorNameHeaders);
  const mentorKeyIndex = findHeader(headers, mentorKeyHeaders);
  const mentorEmailIndex = findHeader(headers, mentorEmailHeaders);
  const mentorPhoneIndex = findHeader(headers, mentorPhoneHeaders);
  const mentorDetailsIndex = findHeader(headers, mentorDetailsHeaders);
  const approvalStatusIndex = findHeader(headers, participantApprovalStatusHeaders);

  if (emailIndex === -1 || nameIndex === -1) {
    throw new CsvValidationError(
      `participant CSV needs email and name columns; found: ${headers.join(", ")}`,
    );
  }

  const activeRows = approvalStatusIndex === -1
    ? rows
    : rows.filter((row) => valueAt(row, approvalStatusIndex).toLowerCase() === "approved");
  if (activeRows.length === 0) {
    throw new CsvValidationError("participant CSV contains no approved guests");
  }

  const participants = activeRows.map((row, index) => {
    const email = valueAt(row, emailIndex).toLowerCase();
    const displayName = valueAt(row, nameIndex);
    const explicitTeamName = valueAt(row, teamIndex);
    const lumaTeamName = valueAt(row, lumaTeamIndex);
    const teamName = explicitTeamName || lumaTeamName || "Team matching";
    const mentorName = valueAt(row, mentorNameIndex) || "Mentor to be assigned";
    const mentorEmail = valueAt(row, mentorEmailIndex).toLowerCase();
    const teamKey = valueAt(row, teamKeyIndex) || (explicitTeamName ? slugify(explicitTeamName) : `unassigned-${slugify(email)}`);
    const mentorKey = valueAt(row, mentorKeyIndex) || mentorEmail || (mentorNameIndex === -1 ? "mentor-tbd" : slugify(mentorName));

    if (!isEmail(email) || !displayName) {
      throw new CsvValidationError(`invalid participant CSV row ${index + 2}`);
    }
    if (mentorEmail && !isEmail(mentorEmail)) {
      throw new CsvValidationError(`invalid mentor email on CSV row ${index + 2}`);
    }

    return {
      email,
      displayName,
      teamKey,
      teamName,
      mentorKey,
      mentorName,
      mentorEmail,
      mentorPhone: valueAt(row, mentorPhoneIndex),
      mentorDetails: valueAt(row, mentorDetailsIndex) || (mentorNameIndex === -1 ? "Mentor assignment will appear here when it is available." : ""),
    } satisfies ParticipantImportRow;
  });

  assertUnique(participants.map((participant) => participant.email), "participant email");
  return participants;
}

export function parseMentorTeamCsv(csv: string): MentorTeamImportRow[] {
  const rows = parseCsvRows(csv);
  const headerIndex = rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return headers.includes("mentor") && headers.includes("team") && headers.includes("members");
  });
  if (headerIndex === -1) {
    throw new CsvValidationError("mentor CSV needs Mentor, Team, and Members columns");
  }

  const headers = rows[headerIndex]!.map(normalizeHeader);
  const mentorIndex = headers.indexOf("mentor");
  const teamIndex = headers.indexOf("team");
  const membersIndex = headers.indexOf("members");
  const notesIndex = headers.indexOf("notes");
  const imports = rows.slice(headerIndex + 1).filter((row) => valueAt(row, teamIndex)).map((row, index) => {
    const teamName = valueAt(row, teamIndex);
    const mentorName = valueAt(row, mentorIndex);
    const memberNames = valueAt(row, membersIndex).split(",").map((name) => name.trim()).filter(Boolean);
    if (!mentorName) throw new CsvValidationError(`mentor CSV row ${headerIndex + index + 2} is missing a mentor`);
    return {
      teamKey: slugify(teamName),
      teamName,
      mentorKey: slugify(mentorName),
      mentorName,
      mentorDetails: valueAt(row, notesIndex),
      memberNames,
    } satisfies MentorTeamImportRow;
  });

  if (imports.length === 0) throw new CsvValidationError("mentor CSV contains no teams");
  assertUnique(imports.flatMap((row) => row.memberNames.map(normalizeParticipantName)), "mentor-sheet member name");
  return imports;
}

export function serializeCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(serializeCsvField).join(","))
    .join("\r\n");
}

function serializeCsvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function normalizeParticipantName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function parseCheckInCsv(csv: string): CheckInImportRow[] {
  const { headers, rows } = parseCsv(csv);
  const emailIndex = findHeader(headers, emailHeaders);
  const statusIndex = findHeader(headers, checkInStatusHeaders);
  if (emailIndex === -1 || statusIndex === -1) {
    throw new CsvValidationError(
      `check-in CSV needs email and checked-in status columns; found: ${headers.join(", ")}`,
    );
  }

  const updates = rows.map((row, index) => {
    const email = valueAt(row, emailIndex).toLowerCase();
    const status = valueAt(row, statusIndex).toLowerCase();
    if (!isEmail(email)) {
      throw new CsvValidationError(`invalid check-in email on CSV row ${index + 2}`);
    }
    if (!["yes", "true", "checked in", "checked_in", "no", "false", "not checked in", "not_checked_in"].includes(status)) {
      throw new CsvValidationError(`invalid check-in status on CSV row ${index + 2}: ${status}`);
    }
    return {
      email,
      checkedIn: ["yes", "true", "checked in", "checked_in"].includes(status),
    } satisfies CheckInImportRow;
  });

  assertUnique(updates.map((update) => update.email), "check-in email");
  return updates;
}

function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const parsedRows = parseCsvRows(csv);
  const [rawHeaders, ...rows] = parsedRows;
  if (!rawHeaders || rows.length === 0) {
    throw new CsvValidationError("CSV needs a header and at least one data row");
  }

  return {
    headers: rawHeaders.map(normalizeHeader),
    rows,
  };
}

function parseCsvRows(csv: string): string[][] {
  const parsedRows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        field += '"';
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (character === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }
    if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim())) {
        parsedRows.push(row);
      }
      row = [];
      field = "";
      continue;
    }
    field += character;
  }

  if (quoted) {
    throw new CsvValidationError("CSV contains an unclosed quoted field");
  }
  row.push(field);
  if (row.some((value) => value.trim())) {
    parsedRows.push(row);
  }

  if (parsedRows.length < 2) {
    throw new CsvValidationError("CSV needs a header and at least one data row");
  }
  return parsedRows;
}

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function findHeader(headers: string[], accepted: Set<string>): number {
  return headers.findIndex((header) => accepted.has(header));
}

function valueAt(row: string[], index: number): string {
  return index === -1 ? "" : row[index]?.trim() ?? "";
}

function slugify(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

function assertUnique(values: string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new CsvValidationError(`duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeCodexCredit(value: string): string {
  return value.toLowerCase().startsWith("chatgpt.com/") ? `https://${value}` : value;
}

function isPromoValue(value: string): boolean {
  return Boolean(value) && !/^javascript:/i.test(value);
}
