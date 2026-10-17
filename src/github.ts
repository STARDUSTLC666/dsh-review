import type { PullRequestEvidence } from './policy.js'
export async function githubEvidence(repository: string, number: number, token: string, expectedHead: string, expectedBase: string, fetcher: typeof fetch = fetch): Promise<PullRequestEvidence> {
 if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !Number.isSafeInteger(number) || number < 1 || [expectedHead,expectedBase].some(sha => !/^[a-f0-9]{40,64}$/.test(sha))) throw new Error('Invalid GitHub repository, pull request or commit')
 const request = async (route: string, body?: unknown) => {
  const response = await fetcher('https://api.github.com' + route, { method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
   headers: { accept: 'application/vnd.github+json', 'content-type': 'application/json', authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2026-03-10', 'user-agent': 'dsh-review-gate' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  if (!response.ok) throw new Error('GitHub evidence unavailable (HTTP ' + response.status + '); gate remains blocked')
  return response.json() as Promise<any>
 }
 const prefix = '/repos/' + repository, pr = await request(prefix + '/pulls/' + number)
 if (pr.head?.sha !== expectedHead || pr.base?.sha !== expectedBase || pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase()) throw new Error('GitHub PR head/base changed or repository mismatch')
 const paged = async (route: string, field?: string) => {
  const values: any[] = []
  for (let page = 1; page <= 30; page++) {
   const data = await request(route + (route.includes('?') ? '&' : '?') + 'per_page=100&page=' + page), rows = field ? data[field] : data
   if (!Array.isArray(rows)) throw new Error('Malformed GitHub evidence')
   values.push(...rows)
   if (rows.length < 100) return values
  }
  throw new Error('GitHub evidence pagination exceeds coverage limit')
 }
 const [reviews, checks, files] = await Promise.all([
  paged(prefix + '/pulls/' + number + '/reviews'),
  paged(prefix + '/commits/' + expectedHead + '/check-runs?filter=all', 'check_runs'),
  paged(prefix + '/pulls/' + number + '/files'),
 ])
 if (files.length !== pr.changed_files || files.some(f => typeof f.filename !== 'string')) throw new Error('Incomplete GitHub changed-file inventory')
 const [owner, repo] = repository.split('/')
 let cursor: string | null = null, unresolvedThreads = 0
 for (let page = 0; ; page++) {
  if (page >= 30) throw new Error('Review-thread coverage limit exceeded')
  const result = await request('/graphql', { query: 'query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefOid reviewThreads(first:100,after:$cursor){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}', variables: { owner, repo, number, cursor } })
  const pull = result.data?.repository?.pullRequest, threads = pull?.reviewThreads
  if (result.errors || pull?.headRefOid !== expectedHead || !Array.isArray(threads?.nodes) || !threads.pageInfo || threads.nodes.some((t: any) => typeof t?.isResolved !== 'boolean')) throw new Error('Review-thread evidence unavailable or changed')
  unresolvedThreads += threads.nodes.filter((t: any) => !t.isResolved).length
  if (threads.pageInfo.hasNextPage === false) break
  if (threads.pageInfo.hasNextPage !== true || typeof threads.pageInfo.endCursor !== 'string' || threads.pageInfo.endCursor === cursor) throw new Error('Invalid thread pagination')
  cursor = threads.pageInfo.endCursor
 }
 const current = await request(prefix + '/pulls/' + number)
 if (current.head?.sha !== expectedHead || current.base?.sha !== expectedBase) throw new Error('PR changed while reading approval evidence')
 return { head: expectedHead, author: pr.user, paths: files.flatMap(f => f.previous_filename ? [f.filename,f.previous_filename] : [f.filename]), draft: pr.draft, reviews, checks, unresolvedThreads }
}
