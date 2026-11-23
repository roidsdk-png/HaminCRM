# Internal analytics API

The CRM server authenticates requests with `Authorization: Bearer ANALYTICS_INTERNAL_TOKEN` and `X-Analytics-Actor` containing the authenticated administrator ID. All `/v1` routes require both headers. `/health` returns only service status. Browser access goes through the CRM proxy.

Run locally from the CRM root with `python -m uvicorn analytics.app:app --host 127.0.0.1 --port 8091`. SQLite development storage and PostgreSQL production storage share the same contracts. Model calls require `ANALYTICS_API_KEY` and `ANALYTICS_MODEL`. `ANALYTICS_EMBEDDING_MODEL` enables semantic retrieval. Missing configuration yields HTTP 503 and `error.code=model_not_configured` for AI creation. Corpus statistics remain available.

## Sync

`POST /v1/sync` accepts `{generation,snapshotId,sequence,mode,sources,records,deletedIds,redactionNames,complete}`. Sequence is a monotonically increasing snapshot creation timestamp in milliseconds. Mode is `full` by default, or `delta`. Root creates canonical IDs `message:<id>`, `test:<id>`, `match:<id>`. Records have `id,kind,sourceId,contactId?,conversationId?,role?,occurredAt,text,metadata`. Time is Unix seconds. Contact IDs are CRM-generated source-scoped HMAC pseudonyms. Sources have `id,slug,name,kind,platform,status`.

Metadata supports `countable,demographics:{gender,age,province,city},testKey,testVersion,questionnaireVersion,scores,result,answers:[{questionKey,questionText,answerValue,answerLabel,score}],aiAnalysis,freeText,verifiedIdentityId`. A verified identity is an HMAC of an owner-confirmed CRM group, without its names or verification notes. Free text must explicitly identify audience-authored text. Structured options, question prompts and AI analyses do not contribute to the audience word cloud. Interpretation uses trusted local guides matched to the exact test/version; raw untrusted guides are not passed as manuals.

Pages stage invisibly until `complete=true`. Full replaces the active corpus atomically. Delta starts from the current corpus, applies upserts/deletions and atomically switches to the new snapshot. An older sequence cannot replace newer data. Retries for a committed snapshot return an idempotent acknowledgement. Known names are used for redaction and discarded.

Response is `{snapshotId,committed,records,idempotent?}`.

## Filters

GET routes accept `filters` as JSON, or query parameters for `from,to,sourceIds,kinds,roles,contactId,includeLinkedContacts,gender,province,ageFrom,ageTo,testKey,includeExcluded,scoreKey,scoreFrom,scoreTo`. With a contact selected, `includeLinkedContacts:true` includes only its verified linked identities and preserves all other filters. List query parameters are comma-separated. Dates are Gregorian `YYYY-MM-DD`, interpreted as inclusive calendar dates in Asia/Tehran. Default message roles include user messages only. Nonfinite score bounds, reversed bounds and score ranges lacking a score key are rejected.

## Read routes

`GET /v1/overview` returns `dataset:{snapshotId,generation,syncedAt}|null`, `configuration:{modelConfigured,embeddingConfigured,model,embeddingModel}`, `sources`, `coverage:{eligible,processed,pending,failed}` and totals `records,messages,userMessages,assistantMessages,conversations,contacts,tests,matches`.

`GET /v1/catalog` returns sources, configuration, fields and provenance/identity descriptions. `GET /v1/config` returns safe configuration booleans, model names, `limits:{monthlyTokens,maxRunRecords,maxRunCalls}` and `usage:{month,inputTokens,outputTokens,calls}`. It never returns credentials. `GET /v1/words?ngram=1&limit=100&metric=conversations` returns `{items:[{term,occurrences,messages,conversations}],totalRecords,metric,range:{from,to},ngram,lexiconVersion}`. The metric may be conversations, messages or occurrences and determines ranking before limiting. `GET /v1/word-evidence?term=...&limit=5` returns `{items:[evidence]}` from a private evidence run excluded from report history.

## Research

`POST /v1/runs` accepts `{kind,query,filters,limit,sessionId?,categories?,evidenceIds?,format?,tone?,length?,requestKey?}`. Kinds are `challenges,emotions,experiences,research,content`. Progress is 0 through 100. `GET /v1/runs/{id}` and `DELETE /v1/runs/{id}` read and cancel. Requests are actor-scoped.

Run shape is `{id,kind,status,progress,processed,eligible,error,result,resultSetId?,stale,createdAt,sessionId?,filters,guideReferences}`. Statuses are `queued,running,completed,failed,cancelled`. Error shape is `{code,message}`. Results have `{answer,labels,items,evidence,coverage,notice?,trends?,calculations?,guideReferences?}`. Guide references are `{testKey,version,source,sha256}` for exact resolved manuals in the selected scope, not proof that every manual was cited by the model. The index is frozen per run. Changing/removing a relevant manual invalidates dependent queued, running and saved analyses; unrelated guides do not invalidate them. Labels have `{label,count,share,evidenceIds}`. Share is percentage 0 through 100. Trend rows have `{day,label,count,share}`.

Experience items have `{id,title,summary,attribution,reason,evidenceIds}`. Evidence has `{id,quote,sourceId,recordId,kind,occurredAt,href,field?}`. Hrefs use safe CRM relative routes. `GET /v1/result-sets/{id}/items?cursor=&limit=3` returns `{items,nextCursor,total}` with immutable ordered items. Deleted or changed source evidence invalidates access to the dependent result. `GET /v1/evidence/{id}` validates ownership and current corpus version.

`POST /v1/sessions` accepts `{title?}` and returns a session detail. `GET /v1/sessions` returns `{items:[{id,title,createdAt,updatedAt}]}`. `GET /v1/sessions/{id}` returns `{id,title,filters,messages:[{id,role,content,runId,createdAt}]}`. `POST /v1/sessions/{id}/messages` accepts `{message,filters?,limit?,cursor?}` and returns a run. A supplied cursor continues the prior immutable experience list without a new model call.

`POST /v1/content` accepts `{prompt,format,evidenceIds,filters,tone,length,sessionId?}` and returns a run. Formats are `article,story,instagram,podcast,ideas`. Sources are verified at generation and read time. All generated timestamps are ISO UTC strings, and record occurrence times are Unix seconds.

## Research tools and grounded numbers

The model may call statistics, approved field selection, bounded arithmetic, lexical/semantic retrieval, full-scope scans, previous result items, versioned test catalog and `expand_cohort`. Cohort expansion uses same-source contact IDs or verified identity groups only and supports before/after/all with an optional day window. `attemptPolicy:latest_per_contact` chooses the latest completed test per source/contact/testKey before score predicates; `all` preserves attempt-level analysis. Unknown identities remain independent attempts. Coverage and selection policy accompany calculations.

Numeric prose requires validated `numericClaims` pointing to actual statistics/calculation paths or numbers present in accepted quotes. This checks numeric values, not the semantic correctness of units or interpretation. Content evidence must survive the current filters and inline citation IDs must match the supplied evidence. Stories always carry an adaptation/fiction notice.

## Owner-managed local resources

`GET/POST /v1/provider-settings` is proxied only for CRM owners. The GET response includes provider/model/base-URL choices and configured-key booleans, never saved keys. POST accepts partial configuration, with empty key fields preserving current keys and explicit `clearApiKey`/`clearEmbeddingApiKey` for deletion. Available provider IDs are `openai,google,openrouter,custom`. Official presets use their exact HTTPS endpoint; alternate gateways use custom. Changing a credential destination requires a new key or explicit clearing. Embedding credentials inherit only for identical provider and endpoint. Saving settings never calls a model and is blocked while queued/running work exists. Settings persist atomically in a private ignored file, override environment fallback and apply to new jobs without restarting. Request validation returns sanitized errors without echoing secret input.

All three built-in routes implement chat completions, function tool calls, JSON output and embeddings via their OpenAI-compatible contracts. Opaque Gemini tool signatures are preserved. Model capability must be checked for the chosen model. OpenAI uses max_completion_tokens; Google/OpenRouter use max_tokens. Embedding cache identity includes provider, endpoint, model and a one-way account hash. Outbound retries count against call limits; missing or invalid provider token reports remain marked as unreported instead of being invented. Config usage exposes unreportedCalls so incomplete token totals are visible.

The CRM proxy restricts `GET/POST /v1/lexicon` and `GET/POST/DELETE /v1/guides` to owners and validates request origin for writes. Lexicon accepts `{stopwords:[...]}`, persists in the analytic database and changes only word-cloud exclusions. Guide import accepts `{guide:{testKey,version,source,scales?|scoring?|interpretation?},confirmed:true}`. Managed files use hashed names in `ANALYTICS_GUIDES_DIR`, default `analytics-data/guides`. Conflicting definitions cannot overwrite the same managed version. DELETE takes `testKey,version` and removes only a managed upload, preserving manually configured external files. Guide catalog exposes ambiguous definitions for correction.

CRM-only `GET/POST/DELETE /api/admin/analysis/identities` is owner-restricted. Creation accepts `{contactIds:[localCRMIds],basis,confirmed:true}`, records the verifier/time and rejects a contact already in an active group. Revocation preserves the local audit and clears active memberships. Membership triggers enqueue affected contacts for delta sync. The model receives only the resulting group pseudonym. This endpoint never forwards names or verification notes to the model service.
