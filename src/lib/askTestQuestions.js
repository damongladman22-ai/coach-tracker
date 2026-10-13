/**
 * The F2 bake-off question set (backlog F2, 2026-10-13).
 *
 * Twenty questions a family might really ask, each with the look-ups a correct
 * answer must use. The bake-off runs every question on every chosen model and
 * checks the look-ups automatically; the answer itself is judged by eye.
 *
 * `expect` lists look-up names that MUST appear. `none: true` means the right
 * answer is a plain "PitchSide does not have that" or a polite refusal, with no
 * made-up numbers -- those questions test honesty, not retrieval.
 */
export const ASK_TEST_QUESTIONS = [
  { id: 1, q: "Which Big Ten women's programs have the most estimated goalkeeper openings for the class of 2027?", expect: ['find_programs'] },
  { id: 2, q: "Show NCAA D3 men's programs in Ohio with the most defender openings for the class of 2028.", expect: ['find_programs'] },
  { id: 3, q: "What was Ohio State women's record in 2025, and what is their RPI rank this season?", expect: ['find_school', 'program_results'] },
  { id: 4, q: "Who coaches the Penn State women's soccer team?", expect: ['find_school', 'program_coaches'] },
  { id: 5, q: "Where did Ohio State women's transfers come from this season?", expect: ['find_school', 'program_transfers'] },
  { id: 6, q: "What are the top 10 NCAA D1 men's teams by RPI right now?", expect: ['rank_by_results'] },
  { id: 7, q: "Which NAIA women's programs in Texas have the best record in 2026 so far?", expect: ['rank_by_results'] },
  { id: 8, q: "Does Kenyon women's soccer mostly recruit freshmen or transfers?", expect: ['find_school', 'program_profile'] },
  { id: 9, q: "How big is Denison and what does it cost?", expect: ['find_school', 'program_profile'] },
  { id: 10, q: "Compare Mizzou and Ole Miss women's records over the last three seasons.", expect: ['find_school', 'program_results'] },
  { id: 11, q: "Which junior college men's programs have the most forward openings for the class of 2027?", expect: ['find_programs'] },
  { id: 12, q: "What is the email address of the UConn men's head coach?", expect: ['find_school', 'program_coaches'] },
  { id: 13, q: "How many players transferred out of the UCLA women's program this season?", expect: ['find_school', 'program_transfers'] },
  { id: 14, q: "NCAA D2 women's programs in Pennsylvania with midfielder openings for the class of 2029?", expect: ['find_programs'] },
  { id: 15, q: "What is the admission rate at Wake Forest?", expect: ['find_school', 'program_profile'] },
  { id: 16, q: "Which SEC women's team has the best record this season?", expect: ['rank_by_results'] },
  { id: 17, q: "Does Siena Heights still have a women's soccer team?", expect: ['find_school'] },
  { id: 18, q: "When can college coaches start contacting my daughter? She is a high school sophomore.", none: true },
  { id: 19, q: "Who is the best goalkeeper in the ACC?", none: true },
  { id: 20, q: "Which college coaches have watched our team play this season?", none: true },
]
