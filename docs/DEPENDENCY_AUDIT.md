# Dependency audit reconciliation — issue #93

Checked 2026-11-03 against develop `7388123`.

## Sources and branch scope

The [Dependabot alerts](https://github.com/Valorthon/grocery-pos/security/dependabot)
API is now accessible: 49 alerts, 48 open and one auto-dismissed. Every alert
identifies `pnpm-lock.yaml`; the API does not identify a source branch. The
default branch is `develop`. `master`, `staging` and `production` still point at
`2e10aa2` and are unchanged by this fix. An alert's presence alone does not prove
it originated on those branches.

A fresh `pnpm audit --json` on develop reports 47 findings: 2 critical, 18 high,
23 moderate, 4 low. After this fix it reports 7 findings: 6 moderate and 1 low,
with no high or critical findings. Counts are advisory/version combinations,
not unique packages. The September conclusion that develop has no known
vulnerabilities is no longer current. Some GitHub alerts are stale; others
correspond to newly published vulnerabilities.

`pnpm audit --prod` reports zero vulnerabilities after this fix.

## Dependency changes

Update body-parser, Zod, Vite, Vitest/coverage and Axios within their existing
major versions. Refresh brace-expansion, source-map-js, handlebars,
follow-redirects, Undici and qs within their declared ranges.

The inherited broad fast-uri overrides resolve fast-uri 4.2.3, outside Ajv
8.18.0/8.20.0's declared `^3.0.1` range. This fixes the current fast-uri
advisories, but is an exception to the compatible-range updates above. The
contracts build, lint, typecheck, full coverage tests, production build and
real-database tests pass with this resolution; those checks do not establish
compatibility for every Ajv URI case. Future override maintenance should prefer
a patched compatible 3.x release or an Ajv-supported newer major.

Nest's current 11.2.8 release still pins Multer 2.4.0. The scoped
`@nestjs/platform-express>multer: 2.5.0` override fixes
[GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m).
Remove it when Nest's declared dependency includes patched Multer. Existing
fast-uri overrides remain unchanged. No advisory is ignored in audit configuration.

## Residual low and moderate findings

These are retained explicitly rather than hidden or replaced with incompatible
major versions. All residual paths are development tools.

| Advisory                                                                                                  | Paths                                                                                           | Reason retained                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate (4 findings) | depcheck directly and through multimatch; Nest CLI through glob; Jest through test-exclude/glob | Fix is 11.0.1; consumers require majors 3, 7, 9 and 10. A blanket override breaks historical callable APIs. Patterns come from trusted repository/tool configuration; review compatible upstream upgrades separately. |
| [glob GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate (2 findings)      | Nest CLI; Jest through test-exclude                                                             | Fix is 14.0.2; consumers require majors 10 and 13. It concerns AbortSignal traversal cancellation. These build/test tools consume the local repository; retain compatible majors pending upstream updates.            |
| [deepmerge GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low                   | Nest CLI through fork-ts-checker-webpack-plugin                                                 | No patched release published. The plugin merges local build configuration, not API request data. Revisit when an upstream fix exists.                                                                                 |

## Alert closure and ongoing checks

Allow GitHub to rescan the merged default branch and automatically close fixed
alerts. Recheck the resulting scan before closing #93. The withdrawn sprintf-js
advisory can be dismissed with that upstream evidence. Historical release branches
still require deliberate promotion; this fix does not deploy them.

Keep the weekly dependency audit and dependency-change CI gate. Optional
Dependabot version-update PRs are not added: they are not required for
reconciliation, and their schedule/grouping is a separate maintenance preference.

## Per-alert comparison

All rows refer to `pnpm-lock.yaml`. “Already patched” and “Absent” describe
develop before this change; “Patched by PR” requires this PR to merge. Alert #31's
advisory was withdrawn upstream. Alert #25 was already auto-dismissed, but its
`>=4.0.0, <5.0.10` vulnerable range still includes the pre-PR brace-expansion
5.0.9; this PR upgrades it to 5.0.12. GitHub state and installed vulnerability
are separate evidence. Do not dismiss still-vulnerable alerts as fixed.

| Alert                                                                  | Package                 | GitHub state   | Develop versions before | Versions after        | Finding            |
| ---------------------------------------------------------------------- | ----------------------- | -------------- | ----------------------- | --------------------- | ------------------ |
| [#1](https://github.com/Valorthon/grocery-pos/security/dependabot/1)   | nanoid                  | open           | 3.3.18                  | 3.3.18                | Already patched    |
| [#2](https://github.com/Valorthon/grocery-pos/security/dependabot/2)   | sanitize-html           | open           | —                       | —                     | Absent             |
| [#3](https://github.com/Valorthon/grocery-pos/security/dependabot/3)   | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Already patched    |
| [#4](https://github.com/Valorthon/grocery-pos/security/dependabot/4)   | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Already patched    |
| [#5](https://github.com/Valorthon/grocery-pos/security/dependabot/5)   | qs                      | open           | 6.16.0                  | 6.17.1                | Already patched    |
| [#6](https://github.com/Valorthon/grocery-pos/security/dependabot/6)   | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Already patched    |
| [#7](https://github.com/Valorthon/grocery-pos/security/dependabot/7)   | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Already patched    |
| [#8](https://github.com/Valorthon/grocery-pos/security/dependabot/8)   | multer                  | open           | 2.4.0                   | 2.5.0                 | Already patched    |
| [#9](https://github.com/Valorthon/grocery-pos/security/dependabot/9)   | qs                      | open           | 6.16.0                  | 6.17.1                | Already patched    |
| [#10](https://github.com/Valorthon/grocery-pos/security/dependabot/10) | multer                  | open           | 2.4.0                   | 2.5.0                 | Already patched    |
| [#11](https://github.com/Valorthon/grocery-pos/security/dependabot/11) | multer                  | open           | 2.4.0                   | 2.5.0                 | Already patched    |
| [#12](https://github.com/Valorthon/grocery-pos/security/dependabot/12) | multer                  | open           | 2.4.0                   | 2.5.0                 | Already patched    |
| [#13](https://github.com/Valorthon/grocery-pos/security/dependabot/13) | js-yaml                 | open           | 3.15.2, 4.3.2           | 3.15.2, 4.3.2         | Already patched    |
| [#14](https://github.com/Valorthon/grocery-pos/security/dependabot/14) | js-yaml                 | open           | 3.15.2, 4.3.2           | 3.15.2, 4.3.2         | Already patched    |
| [#15](https://github.com/Valorthon/grocery-pos/security/dependabot/15) | multer                  | open           | 2.4.0                   | 2.5.0                 | Already patched    |
| [#16](https://github.com/Valorthon/grocery-pos/security/dependabot/16) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#17](https://github.com/Valorthon/grocery-pos/security/dependabot/17) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#18](https://github.com/Valorthon/grocery-pos/security/dependabot/18) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#19](https://github.com/Valorthon/grocery-pos/security/dependabot/19) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#20](https://github.com/Valorthon/grocery-pos/security/dependabot/20) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#21](https://github.com/Valorthon/grocery-pos/security/dependabot/21) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#22](https://github.com/Valorthon/grocery-pos/security/dependabot/22) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#23](https://github.com/Valorthon/grocery-pos/security/dependabot/23) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#24](https://github.com/Valorthon/grocery-pos/security/dependabot/24) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#25](https://github.com/Valorthon/grocery-pos/security/dependabot/25) | brace-expansion         | auto_dismissed | 1.1.18, 2.1.4, 5.0.9    | 1.1.21, 2.1.7, 5.0.12 | Patched by PR      |
| [#26](https://github.com/Valorthon/grocery-pos/security/dependabot/26) | axios                   | open           | 1.20.0                  | 1.21.0                | Already patched    |
| [#27](https://github.com/Valorthon/grocery-pos/security/dependabot/27) | proxy-addr              | open           | 2.0.8                   | 2.0.8                 | Already patched    |
| [#28](https://github.com/Valorthon/grocery-pos/security/dependabot/28) | handlebars              | open           | 4.7.9                   | 4.7.10                | Patched by PR      |
| [#29](https://github.com/Valorthon/grocery-pos/security/dependabot/29) | handlebars              | open           | 4.7.9                   | 4.7.10                | Patched by PR      |
| [#30](https://github.com/Valorthon/grocery-pos/security/dependabot/30) | brace-expansion         | open           | 1.1.18, 2.1.4, 5.0.9    | 1.1.21, 2.1.7, 5.0.12 | Patched by PR      |
| [#31](https://github.com/Valorthon/grocery-pos/security/dependabot/31) | sprintf-js              | open           | 1.0.3                   | 1.0.3                 | Withdrawn advisory |
| [#32](https://github.com/Valorthon/grocery-pos/security/dependabot/32) | source-map-js           | open           | 1.2.1                   | 1.2.2                 | Patched by PR      |
| [#33](https://github.com/Valorthon/grocery-pos/security/dependabot/33) | handlebars              | open           | 4.7.9                   | 4.7.10                | Patched by PR      |
| [#35](https://github.com/Valorthon/grocery-pos/security/dependabot/35) | sanitize-html           | open           | —                       | —                     | Absent             |
| [#36](https://github.com/Valorthon/grocery-pos/security/dependabot/36) | sanitize-html           | open           | —                       | —                     | Absent             |
| [#37](https://github.com/Valorthon/grocery-pos/security/dependabot/37) | follow-redirects        | open           | 1.16.0                  | 1.16.2                | Patched by PR      |
| [#38](https://github.com/Valorthon/grocery-pos/security/dependabot/38) | follow-redirects        | open           | 1.16.0                  | 1.16.2                | Patched by PR      |
| [#39](https://github.com/Valorthon/grocery-pos/security/dependabot/39) | vite                    | open           | 7.3.6                   | 7.3.7                 | Patched by PR      |
| [#40](https://github.com/Valorthon/grocery-pos/security/dependabot/40) | vite                    | open           | 7.3.6                   | 7.3.7                 | Patched by PR      |
| [#41](https://github.com/Valorthon/grocery-pos/security/dependabot/41) | vite                    | open           | 7.3.6                   | 7.3.7                 | Patched by PR      |
| [#42](https://github.com/Valorthon/grocery-pos/security/dependabot/42) | vite                    | open           | 7.3.6                   | 7.3.7                 | Patched by PR      |
| [#43](https://github.com/Valorthon/grocery-pos/security/dependabot/43) | vite                    | open           | 7.3.6                   | 7.3.7                 | Patched by PR      |
| [#44](https://github.com/Valorthon/grocery-pos/security/dependabot/44) | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Patched by PR      |
| [#45](https://github.com/Valorthon/grocery-pos/security/dependabot/45) | multer                  | open           | 2.4.0                   | 2.5.0                 | Patched by PR      |
| [#46](https://github.com/Valorthon/grocery-pos/security/dependabot/46) | body-parser             | open           | 2.3.0                   | 2.4.0                 | Patched by PR      |
| [#47](https://github.com/Valorthon/grocery-pos/security/dependabot/47) | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Patched by PR      |
| [#48](https://github.com/Valorthon/grocery-pos/security/dependabot/48) | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Patched by PR      |
| [#49](https://github.com/Valorthon/grocery-pos/security/dependabot/49) | fast-uri                | open           | 3.1.7                   | 4.2.3                 | Patched by PR      |
| [#50](https://github.com/Valorthon/grocery-pos/security/dependabot/50) | postcss-selector-parser | open           | 7.1.6                   | 7.1.7                 | Already patched    |
