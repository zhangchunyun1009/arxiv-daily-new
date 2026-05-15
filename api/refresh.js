const OWNER = process.env.GITHUB_REPO_OWNER || "zhangchunyun1009";
const REPO = process.env.GITHUB_REPO_NAME || "arxiv-daily-new";
const WORKFLOW_ID = process.env.GITHUB_WORKFLOW_ID || "update-papers.yml";
const BRANCH = process.env.GITHUB_WORKFLOW_BRANCH || "main";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed" });
  }

  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!token) {
    return response.status(500).json({
      error: "Missing GITHUB_DISPATCH_TOKEN in Vercel environment variables."
    });
  }

  const githubResponse = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
    {
      method: "POST",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "arxiv-daily-refresh"
      },
      body: JSON.stringify({ ref: BRANCH })
    }
  );

  if (!githubResponse.ok) {
    const message = await githubResponse.text();
    return response.status(githubResponse.status).json({
      error: `GitHub dispatch failed: ${message.slice(0, 240)}`
    });
  }

  return response.status(202).json({
    ok: true,
    message: "Update workflow dispatched."
  });
}
