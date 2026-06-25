import { Actor } from 'apify';
import Anthropic from '@anthropic-ai/sdk';
import { Resend } from 'resend';

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const JOB_TITLES   = ['Backend Developer', 'Backend Intern', 'Full Stack Developer', 'Software Engineer Intern'];
const SKILLS       = ['Node.js', 'Express.js', 'PostgreSQL', 'JavaScript', 'REST APIs'];
const LOCATIONS    = ['Remote', 'Pune', 'Mumbai'];
const EXCLUDE_KEYWORDS = ['wordpress', 'php', 'marketing', 'sales', 'shopify', 'woocommerce', 'magento'];
const TOP_N        = 5;

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function buildLinkedInURLs() {
  const urls = [];
  for (const title of JOB_TITLES) {
    for (const loc of LOCATIONS) {
      const q   = encodeURIComponent(title);
      const loc2 = encodeURIComponent(loc === 'Remote' ? 'Remote' : loc + ', India');
      urls.push(
        `https://www.linkedin.com/jobs/search/?keywords=${q}&location=${loc2}&f_TPR=r86400&position=1&pageNum=0`
      );
    }
  }
  return urls;
}

function buildRemoteOKTags() {
  return ['node', 'javascript', 'backend', 'express', 'postgresql', 'fullstack', 'intern'];
}

function isExcluded(job) {
  const haystack = [
    job.title, job.description, job.company, ...(job.tags || [])
  ].join(' ').toLowerCase();
  return EXCLUDE_KEYWORDS.some(kw => haystack.includes(kw));
}

function scoreJob(job) {
  const haystack = [
    job.title, job.description, ...(job.tags || [])
  ].join(' ').toLowerCase();

  let score = 0;

  // Title match
  for (const t of JOB_TITLES) {
    if (haystack.includes(t.toLowerCase())) score += 30;
  }

  // Skill match
  const skillMap = { 'node.js': 'node', 'express.js': 'express', 'postgresql': 'postgres', 'javascript': 'javascript', 'rest apis': 'api' };
  for (const [skill, alias] of Object.entries(skillMap)) {
    if (haystack.includes(skill) || haystack.includes(alias)) score += 15;
  }

  // Location match bonus
  const locStr = (job.location || '').toLowerCase();
  if (locStr.includes('remote'))   score += 10;
  if (locStr.includes('pune'))     score += 8;
  if (locStr.includes('mumbai'))   score += 8;

  // Recency (LinkedIn provides listedAt in ms)
  if (job.postedAt) {
    const ageH = (Date.now() - new Date(job.postedAt).getTime()) / 36e5;
    if (ageH < 12) score += 20;
    else if (ageH < 24) score += 10;
  }

  return score;
}

function normalizeLinkedIn(raw) {
  return {
    source:      'LinkedIn',
    id:          raw.id || raw.jobUrl,
    title:       raw.title  || 'N/A',
    company:     raw.companyName || raw.company?.name || 'N/A',
    location:    raw.location   || 'N/A',
    description: raw.description || '',
    tags:        raw.skills || [],
    applyUrl:    raw.jobUrl  || raw.applyUrl || '',
    postedAt:    raw.listedAt ? new Date(raw.listedAt) : null,
  };
}

function normalizeRemoteOK(raw) {
  return {
    source:      'RemoteOK',
    id:          String(raw.id || raw.slug),
    title:       raw.position || 'N/A',
    company:     raw.company  || 'N/A',
    location:    'Remote',
    description: raw.description || '',
    tags:        raw.tags || [],
    applyUrl:    raw.url || `https://remoteok.com/l/${raw.slug}`,
    postedAt:    raw.date ? new Date(raw.date * 1000) : null,
  };
}

// ─── SCRAPING ─────────────────────────────────────────────────────────────────

async function scrapeLinkedIn(apifyClient) {
  console.log('🔍 Scraping LinkedIn...');
  try {
    const run = await apifyClient.actor('curious_coder/linkedin-jobs-scraper').call({
      urls:          buildLinkedInURLs(),
      count:         30,
      scrapeCompany: false,
    });
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 300 });
    console.log(`  LinkedIn → ${items.length} raw jobs`);
    return items.map(normalizeLinkedIn);
  } catch (err) {
    console.error('LinkedIn scrape error:', err.message);
    return [];
  }
}

async function scrapeRemoteOK(apifyClient) {
  console.log('🔍 Scraping RemoteOK...');
  try {
    const run = await apifyClient.actor('inlifeprojects/remoteok-jobs-scraper').call({
      tags:           buildRemoteOKTags(),
      keywordFilter:  'developer OR engineer OR backend OR fullstack OR intern',
      filterNonTech:  true,
      includeUnverified: false,
      maxResults:     80,
    });
    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems({ limit: 200 });
    console.log(`  RemoteOK → ${items.length} raw jobs`);
    return items.map(normalizeRemoteOK);
  } catch (err) {
    console.error('RemoteOK scrape error:', err.message);
    return [];
  }
}

// ─── AI RANKING + EXPLANATION ─────────────────────────────────────────────────

async function rankAndExplainWithAI(jobs, apiKey) {
  console.log(`🤖 Asking Claude to pick & explain top ${TOP_N} from ${jobs.length} candidates...`);
  const client = new Anthropic({ apiKey });

  const jobList = jobs.map((j, i) => ({
    index: i + 1,
    title: j.title,
    company: j.company,
    location: j.location,
    source: j.source,
    tags: j.tags.slice(0, 10),
    snippet: j.description.replace(/<[^>]+>/g, '').slice(0, 300),
    url: j.applyUrl,
  }));

  const prompt = `You are a job-matching assistant helping a developer find the best backend/fullstack roles.

Candidate profile:
- Skills: Node.js, Express.js, PostgreSQL, JavaScript, REST APIs
- Desired roles: Backend Developer, Backend Intern, Full Stack Developer, Software Engineer Intern
- Preferred locations: Remote, Pune (India), Mumbai (India)
- Exclude any roles focused on: WordPress, PHP, Marketing, Sales

Here are ${jobList.length} job listings:
${JSON.stringify(jobList, null, 2)}

Task:
1. Pick the best ${TOP_N} jobs that match the candidate's profile.
2. For each, return a JSON object with these exact fields:
   - index: (original index from the list)
   - title
   - company
   - location
   - source
   - url
   - why_it_matches: 2-sentence explanation of why this job fits the candidate's skills and goals

Return ONLY a valid JSON array of ${TOP_N} objects. No markdown, no extra text.`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content.find(b => b.type === 'text')?.text || '[]';
  try {
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch {
    console.error('AI response parse error. Raw:', raw.slice(0, 300));
    // Fallback: return top N by score
    return jobs.slice(0, TOP_N).map((j, i) => ({
      index: i + 1, title: j.title, company: j.company, location: j.location,
      source: j.source, url: j.applyUrl,
      why_it_matches: `Matches your ${j.tags.slice(0,3).join(', ')} skills.`,
    }));
  }
}

// ─── EMAIL ────────────────────────────────────────────────────────────────────

function buildEmailHTML(picks, date) {
  const dateStr = new Date(date).toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const cards = picks.map((job, i) => `
    <tr>
      <td style="padding:20px 0; border-bottom:1px solid #e8e8e8;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td>
              <span style="display:inline-block;background:#0a66c2;color:#fff;font-size:11px;font-weight:700;
                           padding:3px 10px;border-radius:12px;letter-spacing:0.5px;margin-bottom:8px;">
                #${i + 1} · ${job.source}
              </span>
            </td>
          </tr>
          <tr>
            <td style="font-size:18px;font-weight:700;color:#1a1a2e;padding-bottom:4px;">
              ${job.title}
            </td>
          </tr>
          <tr>
            <td style="font-size:14px;color:#555;padding-bottom:10px;">
              🏢 ${job.company} &nbsp;·&nbsp; 📍 ${job.location}
            </td>
          </tr>
          <tr>
            <td style="background:#f0f7ff;border-left:3px solid #0a66c2;padding:10px 14px;
                       border-radius:0 6px 6px 0;font-size:13px;color:#333;line-height:1.6;margin-bottom:12px;">
              <strong>✨ Why it matches you:</strong><br>${job.why_it_matches}
            </td>
          </tr>
          <tr>
            <td style="padding-top:12px;">
              <a href="${job.url}" target="_blank"
                 style="background:#0a66c2;color:#fff;text-decoration:none;padding:9px 22px;
                        border-radius:6px;font-size:13px;font-weight:600;display:inline-block;">
                Apply Now →
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;
             overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0a66c2 0%,#004182 100%);padding:32px 36px;">
            <div style="font-size:26px;font-weight:800;color:#fff;margin-bottom:6px;">
              🚀 Your Daily Job Alerts
            </div>
            <div style="font-size:13px;color:#a8c8f0;">${dateStr}</div>
            <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
              ${['Node.js','Express.js','PostgreSQL','JavaScript','REST APIs'].map(s =>
                `<span style="background:rgba(255,255,255,0.15);color:#fff;font-size:11px;
                              padding:3px 10px;border-radius:10px;">${s}</span>`
              ).join('')}
            </div>
          </td>
        </tr>

        <!-- Intro -->
        <tr>
          <td style="padding:24px 36px 8px;color:#555;font-size:14px;line-height:1.6;">
            Here are today's <strong>top ${picks.length} handpicked roles</strong> matching your profile.
            These were selected from LinkedIn & RemoteOK listings posted in the last 24 hours.
          </td>
        </tr>

        <!-- Job Cards -->
        <tr>
          <td style="padding:8px 36px 24px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${cards}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8f9fa;padding:20px 36px;text-align:center;
                     font-size:12px;color:#999;border-top:1px solid #eee;">
            Powered by Apify · LinkedIn Jobs Scraper · RemoteOK Scraper · Claude AI<br>
            You're receiving this because you set up a daily job alert on Apify.
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendEmail({ resendApiKey, recipientEmail, subject, html }) {
  const resend = new Resend(resendApiKey);

  const { data, error } = await resend.emails.send({
    from: 'Job Alerts <onboarding@resend.dev>',  // free Resend default sender — no domain needed
    to: recipientEmail,
    subject,
    html,
  });

  if (error) throw new Error(`Resend error: ${JSON.stringify(error)}`);
  console.log(`📧 Email sent! ID: ${data.id}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

Actor.main(async () => {
  const input = await Actor.getInput();
  const {
    anthropicApiKey,
    resendApiKey,
    recipientEmail,
    dryRun = false,
  } = input || {};

  if (!anthropicApiKey) throw new Error('Missing: anthropicApiKey');
  if (!resendApiKey)    throw new Error('Missing: resendApiKey');
  if (!recipientEmail)  throw new Error('Missing: recipientEmail');

  const apifyClient = Actor.newClient();

  // 1. Scrape both sources
  const [linkedInJobs, remoteOKJobs] = await Promise.all([
    scrapeLinkedIn(apifyClient),
    scrapeRemoteOK(apifyClient),
  ]);

  // 2. Merge & filter excluded keywords
  const allJobs = [...linkedInJobs, ...remoteOKJobs].filter(j => !isExcluded(j));
  console.log(`✅ ${allJobs.length} jobs after exclusion filter (from ${linkedInJobs.length + remoteOKJobs.length} total)`);

  if (allJobs.length === 0) {
    console.warn('⚠️ No jobs found today. Skipping email.');
    return;
  }

  // 3. Pre-rank with heuristic score → send top 40 candidates to AI (saves tokens)
  const candidates = allJobs
    .map(j => ({ ...j, _score: scoreJob(j) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 40);

  // 4. AI picks top 5 + explains
  const picks = await rankAndExplainWithAI(candidates, anthropicApiKey);
  console.log(`🏆 Top ${picks.length} jobs selected by AI`);

  // 5. Save to dataset
  await Actor.pushData({ date: new Date().toISOString(), picks });

  if (dryRun) {
    console.log('🧪 Dry run — skipping email send.');
    console.log(JSON.stringify(picks, null, 2));
    return;
  }

  // 6. Build & send email
  const html = buildEmailHTML(picks, new Date());
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  await sendEmail({
    resendApiKey, recipientEmail,
    subject: `🚀 Your Daily Job Picks — ${today} (${picks.length} new roles)`,
    html,
  });

  console.log('✅ Done!');
});
