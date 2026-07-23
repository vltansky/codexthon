import { createClientFromRequest } from "npm:@base44/sdk";
import { matchMentorByEmail, summarizeMentorTeams } from "./mentor-teams.ts";

Deno.serve(async (request) => {
  try {
    const base44 = createClientFromRequest(request);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: "Authentication required" }, { status: 401 });
    }

    // Admin-entered mentor emails may carry mixed casing, so the match happens in code.
    const mentors = await base44.asServiceRole.entities.Mentor.list("display_name", 1000);
    const mentor = matchMentorByEmail(mentors, user.email);
    if (!mentor) {
      return Response.json({ error: "Your email is not on the mentor list" }, { status: 404 });
    }

    const participants = await base44.asServiceRole.entities.Participant.filter({ mentor_key: mentor.mentor_key }, "display_name", 5000);
    return Response.json({
      mentor: { displayName: mentor.display_name, email: mentor.email || null },
      teams: summarizeMentorTeams(participants),
    }, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Could not load mentor portal" },
      { status: 500 },
    );
  }
});
