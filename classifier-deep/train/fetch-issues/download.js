/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.download = void 0;
const axios_1 = require("axios");
const fs_1 = require("fs");
const path_1 = require("path");
const utils_1 = require("../../../common/utils");
const download = async (token, repo, startCursor, isRetry = false) => {
	var _a, _b;
	const data = await axios_1.default
		.post(
			"https://api.github.com/graphql",
			{
				query: `{
      repository(name: "${repo.repo}", owner: "${repo.owner}") {
        issues(last: 100 ${startCursor ? `before: "${startCursor}"` : ""}) {
          pageInfo {
            startCursor
            hasPreviousPage
          }
          nodes {
            body
            title
            number
            createdAt
            userContentEdits(first: 100) {
              nodes {
                editedAt
                diff
              }
            }
            assignees(first: 100) {
              nodes {
                login
              }
            }
            labels(first: 100) {
              nodes {
                name
                color
              }
            }
            timelineItems(itemTypes: [LABELED_EVENT, RENAMED_TITLE_EVENT, UNLABELED_EVENT, CLOSED_EVENT], first: 100) {
              nodes {
                __typename
                ... on UnlabeledEvent {
                  createdAt
                  label { name }
                }
                ... on LabeledEvent {
                  createdAt
                  label { name }
                  actor { login }
                }
                ... on RenamedTitleEvent {
                  createdAt
                  currentTitle
                  previousTitle
                }
                ... on ClosedEvent {
                  __typename
                }
              }
            }
          }
        }
      }
      rateLimit {
        cost
        remaining
      }
    }`,
			},
			{
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					Authorization: "bearer " + token,
					"User-Agent":
						"github-actions://microsoft/vscode-github-triage-actions#fetch-issues",
				},
			},
		)
		.then((r) => r.data);
	const response = data.data;
	if (
		!((_b =
			(_a =
				response === null || response === void 0
					? void 0
					: response.repository) === null || _a === void 0
				? void 0
				: _a.issues) === null || _b === void 0
			? void 0
			: _b.nodes)
	) {
		(0, utils_1.safeLog)(
			"recieved unexpected response",
			JSON.stringify(data),
		);
		if (isRetry) {
			console.error("max retries exceeded");
			return;
		}
		return new Promise((resolve) => {
			setTimeout(async () => {
				await (0, exports.download)(token, repo, startCursor, true);
				resolve();
			}, 60000);
		});
	}
	const issues = response.repository.issues.nodes.map((issue) => ({
		number: issue.number,
		title: issue.title,
		body: issue.body,
		createdAt: +new Date(issue.createdAt),
		labels: issue.labels.nodes.map((label) => ({
			name: label.name,
			color: label.color,
		})),
		assignees: issue.assignees.nodes.map((assignee) => assignee.login),
		labelEvents: extractLabelEvents(issue),
		closedWithCode: !!issue.timelineItems.nodes.find((event) => {
			var _a, _b;
			return (
				event.__typename === "ClosedEvent" &&
				(((_a = event.closer) === null || _a === void 0
					? void 0
					: _a.__typename) === "PullRequest" ||
					((_b = event.closer) === null || _b === void 0
						? void 0
						: _b.__typename) === "Commit")
			);
		}),
	}));
	(0, fs_1.writeFileSync)(
		(0, path_1.join)(__dirname, "issues.json"),
		issues.map((issue) => JSON.stringify(issue)).join("\n") + "\n",
		{
			flag: "a",
		},
	);
	const pageInfo = response.repository.issues.pageInfo;
	const rateInfo = response.rateLimit;
	console.log({
		lastIssue: issues[issues.length - 1].number,
		quota: rateInfo.remaining,
		startCursor: pageInfo.startCursor,
	});
	startCursor = pageInfo.startCursor;
	if (pageInfo.hasPreviousPage) {
		return new Promise((resolve) => {
			setTimeout(async () => {
				await (0, exports.download)(token, repo, startCursor);
				resolve();
			}, 5000);
		});
	}
};
exports.download = download;
const extractLabelEvents = (_issue) => {
	var _a, _b, _c, _d;
	const issue = _issue;
	const events = [];
	events.push(
		...issue.userContentEdits.nodes.map((node) => ({
			timestamp: +new Date(node.editedAt),
			type: "bodyEdited",
			new: node.diff,
		})),
	);
	events.push(
		...issue.timelineItems.nodes
			.filter((node) => node.__typename === "LabeledEvent")
			.map((node) => ({ ...node, issue }))
			.map((node) => {
				var _a, _b;
				return {
					timestamp: +new Date(node.createdAt),
					type: "labeled",
					label: node.label.name,
					actor:
						(_b =
							(_a = node.actor) === null || _a === void 0
								? void 0
								: _a.login) !== null && _b !== void 0
							? _b
							: "ghost",
				};
			}),
	);
	events.push(
		...issue.timelineItems.nodes
			.filter((node) => node.__typename === "UnlabeledEvent")
			.map((node) => ({
				timestamp: +new Date(node.createdAt),
				type: "unlabeled",
				label: node.label.name,
			})),
	);
	events.push(
		...issue.timelineItems.nodes
			.filter((node) => node.__typename === "RenamedTitleEvent")
			.map((node) => ({
				timestamp: +new Date(node.createdAt),
				type: "titleEdited",
				new: node.currentTitle,
				old: node.previousTitle,
			})),
	);
	events.sort(({ timestamp: a }, { timestamp: b }) => a - b);
	let currentTitle =
		(_b =
			(_a = events.find((event) => event.type === "titleEdited")) ===
				null || _a === void 0
				? void 0
				: _a.old) !== null && _b !== void 0
			? _b
			: issue.title;
	let currentBody =
		(_d =
			(_c = events.find((event) => event.type === "bodyEdited")) ===
				null || _c === void 0
				? void 0
				: _c.new) !== null && _d !== void 0
			? _d
			: issue.body;
	const labelEvents = [];
	for (const event of events) {
		if (event.type === "labeled") {
			labelEvents.push({
				type: "added",
				actor: event.actor,
				label: event.label,
				body: currentBody,
				title: currentTitle,
			});
		} else if (event.type === "bodyEdited") {
			currentBody = event.new;
		} else if (event.type === "titleEdited") {
			currentTitle = event.new;
		} else if (event.type === "unlabeled") {
			labelEvents.push({ type: "removed", label: event.label });
		}
	}
	return labelEvents;
};
//# sourceMappingURL=download.js.map
