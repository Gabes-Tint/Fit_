/**
 * The development-flow driver (workflow/go.py) as data: every box, diamond and
 * outcome it can reach, derived from the Python code rather than from
 * docs/development-flow.md. Rendering lives elsewhere; later slices light nodes
 * up by id from live run state, so ids are stable and never reused.
 *
 * `source` names the function that owns the node, relative to workflow/.
 */

export type NodeKind = 'step' | 'decision' | 'terminal';
export type BlockId = 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 'resume' | 'reset';
export type TerminalTone = 'entry' | 'success' | 'stop';

/** fitflow/outcome.py: Outcome, name to exit code. */
export const OUTCOMES = {
	SHIPPED: 0,
	RESET: 0,
	NOTHING_TO_PICK: 10,
	NEEDS_GABRIEL: 11,
	CANNOT_PICK: 20,
	AGENT_FAILED: 21,
	AGENT_BROKE_CONTRACT: 22,
	TESTS_NOT_PUSHED: 23,
	TESTS_DO_NOT_FAIL: 24,
	WORKTREE_EXISTS: 25,
	TOOL_FAILED: 26,
	PLAN_REJECTED: 27,
	CAPACITY_EXHAUSTED: 28,
	EXECUTION_HELD: 29,
	RUN_STATE_CONFLICT: 30,
	TESTS_INVALID: 31,
	DEPLOY_FAILED: 32
} as const;
export type OutcomeName = keyof typeof OUTCOMES;

export interface FlowNode {
	id: string;
	kind: NodeKind;
	label: string;
	block: BlockId;
	source: string;
	detail?: string;
	note?: string;
	tone?: TerminalTone;
	outcomes?: OutcomeName[];
}

export interface FlowEdge {
	from: string;
	to: string;
	label?: string;
}

export interface FlowBlock {
	id: BlockId;
	title: string;
}

export const blocks: FlowBlock[] = [
	{ id: 'b1', title: '1 · Pick and plan' },
	{ id: 'b2', title: '2 · Delegate' },
	{ id: 'b3', title: '3 · Implement and validate' },
	{ id: 'b4', title: '4 · Deliver: review, CI, merge' },
	{ id: 'b5', title: '5 · Ship' },
	{ id: 'resume', title: 'Resume · go.py N --resume' },
	{ id: 'reset', title: 'Reset · go.py N --reset' }
];

type Extra = Pick<FlowNode, 'detail' | 'note'>;

const step = (id: string, block: BlockId, label: string, source: string, extra: Extra = {}) =>
	({ id, kind: 'step', block, label, source, ...extra }) satisfies FlowNode;

const decision = (id: string, block: BlockId, label: string, source: string, extra: Extra = {}) =>
	({ id, kind: 'decision', block, label, source, ...extra }) satisfies FlowNode;

const stop = (block: BlockId, outcomes: OutcomeName[], source: string, extra: Extra = {}) =>
	({
		id: `${block}.stop.${outcomes.join('+')}`,
		kind: 'terminal',
		tone: 'stop',
		block,
		label: outcomes.join(' / '),
		outcomes,
		source,
		...extra
	}) satisfies FlowNode;

const entry = (id: string, block: BlockId, label: string, source: string, extra: Extra = {}) =>
	({ id, kind: 'terminal', tone: 'entry', block, label, source, ...extra }) satisfies FlowNode;

const success = (block: BlockId, outcome: OutcomeName, source: string, extra: Extra = {}) =>
	({
		id: `${block}.done.${outcome}`,
		kind: 'terminal',
		tone: 'success',
		block,
		label: outcome,
		outcomes: [outcome],
		source,
		...extra
	}) satisfies FlowNode;

const stopId = (block: BlockId, ...outcomes: OutcomeName[]) =>
	`${block}.stop.${outcomes.join('+')}`;

// --- Block 1: pick and plan ---------------------------------------------------

const block1: FlowNode[] = [
	entry('b1.start', 'b1', 'go.py [issue]', 'go.py:pick_and_plan', {
		detail:
			'A fresh run. cli.run validates the agent roster and ship targets first (exit 2 on a bad configuration); any unexpected exception anywhere ends as TOOL_FAILED.'
	}),
	step('b1.sync', 'b1', 'Fetch origin', 'fitflow/steps/sync.py:sync'),
	decision('b1.named', 'b1', 'Issue named?', 'fitflow/steps/pick.py:pick_story'),
	step('b1.list', 'b1', 'List open stories', 'fitflow/steps/pick.py:_pick_lowest'),
	decision('b1.free', 'b1', 'Any story free?', 'fitflow/steps/pick.py:_pick_lowest', {
		detail: 'Free = not labelled in-progress, blocked, needs-gabriel or paused. Lowest number wins.'
	}),
	step('b1.view', 'b1', 'View named issue', 'fitflow/steps/pick.py:_pick_explicit'),
	decision('b1.pickable', 'b1', 'Open story?', 'fitflow/steps/pick.py:_pick_explicit', {
		detail: 'The issue exists, is OPEN, and carries the story label.'
	}),
	decision(
		'b1.retained',
		'b1',
		'Stopped run retained?',
		'fitflow/steps/pick.py:_refuse_a_stopped_run',
		{
			detail: 'runstate.refuse_retained_run: a record whose run is gone must be resumed or reset.',
			note: 'Skipped while a live run holds the story lock; that run is refused by the hold or the lock instead.'
		}
	),
	decision('b1.held', 'b1', 'Held by a label?', 'fitflow/steps/pick.py:_pick_explicit', {
		note: 'Only a named issue is asked this; the lowest pick already filtered held stories out.'
	}),
	decision('b1.lock', 'b1', 'Story lock free?', 'fitflow/runstate.py:story_lock'),
	step('b1.context', 'b1', 'Gather issue context', 'fitflow/issue_context.py:prepare', {
		detail: 'Comments and timeline, normalised into one chronological context.'
	}),
	step('b1.whose', 'b1', 'Whose call? turn', 'fitflow/steps/whose_call.py:whose_call', {
		detail:
			'One planner turn, schema whose_call.json. agents.talk failures stop with AGENT_FAILED or TOOL_FAILED.'
	}),
	decision('b1.gabriel', 'b1', "Gabriel's call?", 'go.py:pick_and_plan'),
	step('b1.hand', 'b1', 'Label needs-gabriel, ask', 'fitflow/steps/whose_call.py:hand_to_gabriel', {
		detail:
			'Adds needs-gabriel, assigns Gabriel, comments the question, options (plus "Do nothing") and recommendation.'
	}),
	step('b1.hold', 'b1', 'Label in-progress', 'fitflow/steps/hold.py:hold'),
	step('b1.plan', 'b1', 'Planner slices story', 'fitflow/steps/slicing.py:_planned', {
		detail: 'Initial slicing turn plus at most two corrections in the same planner session.'
	}),
	decision(
		'b1.contract',
		'b1',
		'Slice contract kept?',
		'fitflow/steps/slicing.py:_check_contract',
		{
			detail:
				'Not spanning = exactly one slice; spanning = exactly two, domain then UI. Never retried.'
		}
	),
	decision(
		'b1.contradicts',
		'b1',
		'Brief contradicts layer?',
		'fitflow/steps/slicing.py:_contradiction'
	),
	decision('b1.plan_left', 'b1', 'Planner attempts left?', 'fitflow/steps/slicing.py:_planned', {
		detail: '_MAX_PLANNER_ATTEMPTS = 3.'
	}),
	decision(
		'b1.spans',
		'b1',
		'Spans domain and UI?',
		'fitflow/steps/slicing.py:slice_at_layer_boundary'
	),
	step('b1.split', 'b1', 'Create child issues', 'fitflow/steps/slicing.py:_split'),
	step('b1.keep', 'b1', 'Keep as one slice', 'fitflow/steps/slicing.py:_keep_as_is'),
	step('b1.record', 'b1', 'Create run record', 'fitflow/runstate.py:create_run', {
		detail: 'From here a stopped run is resumed, never replanned.'
	}),
	decision(
		'b1.pending',
		'b1',
		'Tests still to write?',
		'fitflow/steps/failing_tests.py:write_failing_tests',
		{
			detail:
				'Slices whose acceptance tests the record does not already hold frozen. Two slices run in parallel.'
		}
	),
	step('b1.prepare', 'b1', 'Prepare slice worktree', 'fitflow/steps/failing_tests.py:_prepare'),
	decision(
		'b1.wt_exists',
		'b1',
		'Worktree already exists?',
		'fitflow/steps/failing_tests.py:_prepare',
		{
			note: 'On --resume the existing worktree is reused instead; a slice with retained test attempts but no worktree stops with RUN_STATE_CONFLICT.'
		}
	),
	step('b1.writer', 'b1', 'Writer turn', 'fitflow/steps/failing_tests.py:_run_attempt', {
		detail: 'Mechanic first; the same branch, worktree and team across attempts and rungs.'
	}),
	decision(
		'b1.verify',
		'b1',
		'Pushed, valid, failing?',
		'fitflow/steps/failing_tests.py:_verify_pushed',
		{
			detail:
				'Clean tree pushed, test-side files only, in the right place, lint/type/content gates, and the tests really fail.'
		}
	),
	decision(
		'b1.repairable',
		'b1',
		'Repairable verdict?',
		'fitflow/steps/failing_tests.py:_repairable',
		{
			detail: 'TESTS_NOT_PUSHED, TESTS_DO_NOT_FAIL or TESTS_INVALID, and not a reasoned refusal.'
		}
	),
	decision('b1.attempts', 'b1', 'Attempts left, new diagnostic?', 'fitflow/turns.py:repair_loop', {
		detail: 'turns.BUDGET = 3 per role; a diagnostic repeated verbatim ends the role early.'
	}),
	decision(
		'b1.ladder',
		'b1',
		'Writer below solver?',
		'fitflow/steps/failing_tests.py:_write_tests'
	),
	step('b1.escalate', 'b1', 'Escalate writer', 'fitflow/steps/failing_tests.py:_escalate', {
		detail: 'mechanic → builder → solver, fresh budget, full rejection history.'
	}),
	step('b1.freeze', 'b1', 'Freeze tests', 'fitflow/steps/failing_tests.py:_run_attempt', {
		detail: 'Records test files, the writer role and the acceptance commit in the run record.'
	}),
	step(
		'b1.barrier',
		'b1',
		'Mechanic barrier',
		'fitflow/steps/failing_tests.py:write_failing_tests',
		{
			note: 'With two slices, failures are collected here after both settle and the first one is raised.'
		}
	),
	step('b1.report', 'b1', 'Report planned', 'fitflow/steps/report.py:report_planned'),
	stop('b1', ['NOTHING_TO_PICK'], 'go.py:pick_and_plan'),
	stop('b1', ['CANNOT_PICK'], 'fitflow/steps/pick.py:_pick_explicit'),
	stop('b1', ['RUN_STATE_CONFLICT'], 'fitflow/runstate.py:refuse_retained_run'),
	stop('b1', ['EXECUTION_HELD'], 'fitflow/runstate.py:story_lock'),
	stop('b1', ['NEEDS_GABRIEL'], 'go.py:pick_and_plan'),
	stop('b1', ['AGENT_BROKE_CONTRACT'], 'fitflow/steps/slicing.py:_check_contract'),
	stop('b1', ['PLAN_REJECTED'], 'fitflow/steps/slicing.py:_planned', {
		detail: 'Adds the blocked label.'
	}),
	stop('b1', ['WORKTREE_EXISTS'], 'fitflow/steps/failing_tests.py:_prepare'),
	stop('b1', ['AGENT_FAILED', 'TOOL_FAILED'], 'fitflow/agents.py:talk', {
		detail:
			'A writer turn that failed outright, or a reasoned refusal (TESTS_NOT_PUSHED), is not retried.'
	}),
	stop(
		'b1',
		['TESTS_INVALID', 'TESTS_DO_NOT_FAIL', 'TESTS_NOT_PUSHED'],
		'fitflow/steps/failing_tests.py:_write_tests',
		{
			detail: "The solver's last verdict, after every rung spent its budget."
		}
	)
];

const block1Edges: FlowEdge[] = [
	{ from: 'b1.start', to: 'b1.sync' },
	{ from: 'b1.sync', to: 'b1.named' },
	{ from: 'b1.named', to: 'b1.view', label: 'yes' },
	{ from: 'b1.named', to: 'b1.list', label: 'no' },
	{ from: 'b1.list', to: 'b1.free' },
	{ from: 'b1.free', to: stopId('b1', 'NOTHING_TO_PICK'), label: 'no' },
	{ from: 'b1.free', to: 'b1.retained', label: 'lowest' },
	{ from: 'b1.view', to: 'b1.pickable' },
	{ from: 'b1.pickable', to: stopId('b1', 'CANNOT_PICK'), label: 'no' },
	{ from: 'b1.pickable', to: 'b1.retained', label: 'yes' },
	{ from: 'b1.retained', to: stopId('b1', 'RUN_STATE_CONFLICT'), label: 'yes' },
	{ from: 'b1.retained', to: 'b1.held', label: 'no' },
	{ from: 'b1.held', to: stopId('b1', 'CANNOT_PICK'), label: 'yes' },
	{ from: 'b1.held', to: 'b1.lock', label: 'no' },
	{ from: 'b1.lock', to: stopId('b1', 'EXECUTION_HELD'), label: 'no' },
	{ from: 'b1.lock', to: 'b1.context', label: 'yes' },
	{ from: 'b1.context', to: 'b1.whose' },
	{ from: 'b1.whose', to: 'b1.gabriel' },
	{ from: 'b1.gabriel', to: 'b1.hand', label: 'yes' },
	{ from: 'b1.hand', to: stopId('b1', 'NEEDS_GABRIEL') },
	{ from: 'b1.gabriel', to: 'b1.hold', label: 'no' },
	{ from: 'b1.hold', to: 'b1.plan' },
	{ from: 'b1.plan', to: 'b1.contract' },
	{ from: 'b1.contract', to: stopId('b1', 'AGENT_BROKE_CONTRACT'), label: 'no' },
	{ from: 'b1.contract', to: 'b1.contradicts', label: 'yes' },
	{ from: 'b1.contradicts', to: 'b1.plan_left', label: 'yes' },
	{ from: 'b1.plan_left', to: 'b1.plan', label: 'yes: same session' },
	{ from: 'b1.plan_left', to: stopId('b1', 'PLAN_REJECTED'), label: 'no' },
	{ from: 'b1.contradicts', to: 'b1.spans', label: 'no' },
	{ from: 'b1.spans', to: 'b1.split', label: 'yes' },
	{ from: 'b1.spans', to: 'b1.keep', label: 'no' },
	{ from: 'b1.split', to: 'b1.record' },
	{ from: 'b1.keep', to: 'b1.record' },
	{ from: 'b1.record', to: 'b1.pending' },
	{ from: 'b1.pending', to: 'b1.prepare', label: 'yes, per slice' },
	{ from: 'b1.pending', to: 'b1.report', label: 'no' },
	{ from: 'b1.prepare', to: 'b1.wt_exists' },
	{ from: 'b1.wt_exists', to: stopId('b1', 'WORKTREE_EXISTS'), label: 'yes' },
	{ from: 'b1.wt_exists', to: 'b1.writer', label: 'no' },
	{ from: 'b1.writer', to: 'b1.verify' },
	{ from: 'b1.verify', to: 'b1.freeze', label: 'yes' },
	{ from: 'b1.verify', to: 'b1.repairable', label: 'no' },
	{ from: 'b1.repairable', to: stopId('b1', 'AGENT_FAILED', 'TOOL_FAILED'), label: 'no' },
	{ from: 'b1.repairable', to: 'b1.attempts', label: 'yes' },
	{ from: 'b1.attempts', to: 'b1.writer', label: 'yes: correct' },
	{ from: 'b1.attempts', to: 'b1.ladder', label: 'no' },
	{ from: 'b1.ladder', to: 'b1.escalate', label: 'yes' },
	{
		from: 'b1.ladder',
		to: stopId('b1', 'TESTS_INVALID', 'TESTS_DO_NOT_FAIL', 'TESTS_NOT_PUSHED'),
		label: 'no: solver'
	},
	{ from: 'b1.escalate', to: 'b1.writer' },
	{ from: 'b1.freeze', to: 'b1.barrier' },
	{ from: 'b1.barrier', to: 'b1.report' },
	{ from: 'b1.report', to: 'b2.begin', label: 'fresh run' },
	{ from: 'b1.report', to: 'r.context', label: 'on --resume' }
];

// --- Block 2: delegate --------------------------------------------------------

const block2: FlowNode[] = [
	step('b2.begin', 'b2', 'Begin block 2 on record', 'fitflow/runstate.py:begin_run', {
		detail: 'Reloads the record block 1 created; stops RUN_STATE_CONFLICT if a slice is not frozen.'
	}),
	step('b2.signals', 'b2', 'Planner signals turn', 'fitflow/steps/delegate.py:_signal_proposals', {
		detail: 'The nine signals with evidence per slice. A changed planner session stops TOOL_FAILED.'
	}),
	decision('b2.valid', 'b2', 'Reply valid?', 'fitflow/steps/delegate.py:_validate_reply'),
	decision(
		'b2.left',
		'b2',
		'Planner attempts left?',
		'fitflow/steps/delegate.py:_signal_proposals',
		{
			detail: '_MAX_PLANNER_ATTEMPTS = 3, same planner session.'
		}
	),
	decision(
		'b2.contradict',
		'b2',
		'Signals contradict?',
		'fitflow/selection.py:check_contradictions'
	),
	decision('b2.clarify', 'b2', 'Needs clarification?', 'fitflow/selection.py:_clarification', {
		detail: 'A product decision is still open, or the objective is not clear.'
	}),
	step('b2.ask', 'b2', 'Ask on slice issue', 'fitflow/steps/delegate.py:_clarify'),
	decision('b2.role', 'b2', 'Required capability?', 'fitflow/selection.py:select_role', {
		detail:
			'The precedence table: row 3 solver conditions, else row 4 complete procedure, else row 5.'
	}),
	step('b2.solver', 'b2', 'solver', 'fitflow/selection.py:select_role'),
	step('b2.mechanic', 'b2', 'mechanic', 'fitflow/selection.py:select_role'),
	step('b2.builder', 'b2', 'builder', 'fitflow/selection.py:select_role'),
	decision('b2.envelope', 'b2', 'Envelope valid?', 'fitflow/assignment.py:validate_envelope'),
	step('b2.barrier', 'b2', 'Pre-launch barrier', 'fitflow/steps/delegate.py:_launch_barrier'),
	decision(
		'b2.worktree',
		'b2',
		'Slice worktree exists?',
		'fitflow/steps/delegate.py:_verify_slice_resources'
	),
	decision(
		'b2.intact',
		'b2',
		'Clean, pushed, at test commit?',
		'fitflow/steps/delegate.py:_verify_slice_content',
		{
			detail:
				'Team and branch identity, clean worktree, HEAD at failing_sha, pushed, test files present.'
		}
	),
	stop('b2', ['PLAN_REJECTED'], 'fitflow/steps/delegate.py:_reject', {
		detail: 'Block 2 stops add the blocked label.'
	}),
	stop('b2', ['NEEDS_GABRIEL'], 'fitflow/steps/delegate.py:_decide'),
	stop('b2', ['AGENT_BROKE_CONTRACT'], 'fitflow/steps/delegate.py:_barrier_contract')
];

const block2Edges: FlowEdge[] = [
	{ from: 'b2.begin', to: 'b2.signals' },
	{ from: 'b2.signals', to: 'b2.valid' },
	{ from: 'b2.valid', to: 'b2.left', label: 'no' },
	{ from: 'b2.left', to: 'b2.signals', label: 'yes: diagnostic' },
	{ from: 'b2.left', to: stopId('b2', 'PLAN_REJECTED'), label: 'no' },
	{ from: 'b2.valid', to: 'b2.contradict', label: 'yes, per slice' },
	{ from: 'b2.contradict', to: stopId('b2', 'PLAN_REJECTED'), label: 'yes' },
	{ from: 'b2.contradict', to: 'b2.clarify', label: 'no' },
	{ from: 'b2.clarify', to: 'b2.ask', label: 'yes' },
	{ from: 'b2.ask', to: stopId('b2', 'NEEDS_GABRIEL') },
	{ from: 'b2.clarify', to: 'b2.role', label: 'no' },
	{ from: 'b2.role', to: 'b2.solver', label: 'row 3' },
	{ from: 'b2.role', to: 'b2.mechanic', label: 'row 4' },
	{ from: 'b2.role', to: 'b2.builder', label: 'row 5' },
	{ from: 'b2.solver', to: 'b2.envelope' },
	{ from: 'b2.mechanic', to: 'b2.envelope' },
	{ from: 'b2.builder', to: 'b2.envelope' },
	{ from: 'b2.envelope', to: stopId('b2', 'PLAN_REJECTED'), label: 'no' },
	{ from: 'b2.envelope', to: 'b2.barrier', label: 'yes' },
	{ from: 'b2.barrier', to: 'b2.worktree' },
	{ from: 'b2.worktree', to: stopId('b2', 'PLAN_REJECTED'), label: 'no' },
	{ from: 'b2.worktree', to: 'b2.intact', label: 'yes' },
	{ from: 'b2.intact', to: stopId('b2', 'AGENT_BROKE_CONTRACT'), label: 'no' },
	{ from: 'b2.intact', to: 'b3.todo', label: 'yes' }
];

// --- Block 3: implement and validate ------------------------------------------

const block3: FlowNode[] = [
	decision('b3.todo', 'b3', 'Slices still to run?', 'fitflow/steps/implement.py:_run_loops', {
		note: 'A resumed run brings frozen slices along; they are only re-verified at the join.'
	}),
	decision('b3.dependent', 'b3', 'UI waits on domain?', 'fitflow/steps/implement.py:_dependent_ui'),
	decision('b3.count', 'b3', 'One slice or two?', 'fitflow/steps/implement.py:_run_loops'),
	decision('b3.entry', 'b3', 'Slice state on entry?', 'fitflow/steps/implement.py:_run_slice', {
		detail:
			'A resumed slice may arrive tests_rejected (repair relaunched) or running with a retained reply (re-judged, no new agent call).'
	}),
	step('b3.barrier', 'b3', 'Pre-turn barrier', 'fitflow/steps/implement.py:_pre_turn_barrier', {
		detail:
			'Exclusive ownership, team ownership, assignment revision and config, branch, previous turn settled.'
	}),
	decision(
		'b3.barrier_ok',
		'b3',
		'Ownership intact?',
		'fitflow/steps/implement.py:_pre_turn_barrier'
	),
	step('b3.turn', 'b3', 'Implementer turn', 'fitflow/steps/implement.py:_launch_turn', {
		detail: 'Attempt 1 "implement", later "correct_implementation", in the role\'s own session.'
	}),
	decision(
		'b3.turn_ok',
		'b3',
		'Turn replied well-formed?',
		'fitflow/steps/implement.py:_launch_turn'
	),
	decision('b3.objection', 'b3', 'Objects to the tests?', 'fitflow/steps/objection.py:consider'),
	decision('b3.obj_ok', 'b3', 'Objection verified?', 'fitflow/steps/objection.py:_verify', {
		detail:
			"Names this slice's tests, HEAD unmoved, in scope, and the named tests really fail on the tree."
	}),
	decision(
		'b3.repairs_left',
		'b3',
		'Test repairs left?',
		'fitflow/steps/objection.py:_check_repair_budget',
		{
			detail: 'MAX_REPAIRS = 2 per slice.'
		}
	),
	step('b3.repair', 'b3', 'Block 1 writer repairs tests', 'fitflow/steps/objection.py:repair', {
		detail:
			"In a driver-owned repair worktree, REPAIR_TURNS = 2, re-validated with block 1's checks."
	}),
	decision('b3.repair_ok', 'b3', 'Repair validated?', 'fitflow/steps/objection.py:_repair_loop'),
	step('b3.refreeze', 'b3', 'Re-freeze tests on slice', 'fitflow/steps/objection.py:_refreeze'),
	decision(
		'b3.worktree_ok',
		'b3',
		'Worktree contract kept?',
		'fitflow/steps/implement.py:_check_worktree_state',
		{
			detail: 'HEAD at the test commit, nothing pushed by the agent.'
		}
	),
	decision('b3.changed', 'b3', 'Anything changed?', 'fitflow/steps/implement.py:_validate_turn'),
	decision(
		'b3.bytes',
		'b3',
		'Acceptance bytes unchanged?',
		'fitflow/steps/implement.py:_check_acceptance_unchanged',
		{
			detail: 'Judged before scope and terminal: never softened into a correction.'
		}
	),
	decision('b3.scope', 'b3', 'Within slice scope?', 'fitflow/steps/implement.py:_check_scope'),
	step('b3.accept', 'b3', 'Run acceptance tests', 'fitflow/acceptance.py:run_and_check_passing'),
	decision(
		'b3.passes',
		'b3',
		'Acceptance passes?',
		'fitflow/steps/implement.py:_validate_behavior',
		{
			detail: 'An unrepairable acceptance run (tooling) stops TOOL_FAILED.'
		}
	),
	decision(
		'b3.test_broken',
		'b3',
		'Tests themselves broken?',
		'fitflow/steps/implement.py:_check_acceptance_is_sound'
	),
	step('b3.gates', 'b3', 'Run turn gates', 'fitflow/steps/implement.py:_run_turn_gates'),
	decision('b3.green', 'b3', 'Gates green?', 'fitflow/steps/implement.py:_judge_gates'),
	decision(
		'b3.flake',
		'b3',
		'Untouched files, reruns left?',
		'fitflow/steps/implement.py:_judge_gates',
		{
			detail:
				'A failure only in files the slice never touched earns a rerun; _FLAKE_CYCLES = 2 per slice.'
		}
	),
	step('b3.rerun', 'b3', 'Rerun tier, then solo', 'fitflow/steps/implement.py:_rerun_then_solo'),
	decision('b3.solo', 'b3', 'Passes alone?', 'fitflow/steps/implement.py:_solo_run'),
	decision(
		'b3.blame',
		'b3',
		'Gates blame only the tests?',
		'fitflow/steps/implement.py:_check_gate_blames_the_implementation'
	),
	decision(
		'b3.budget',
		'b3',
		'Attempts left, new diagnostic?',
		'fitflow/steps/implement.py:_settle',
		{
			detail: 'turns.BUDGET = 3 per role; the same diagnostic twice ends the role early.'
		}
	),
	step('b3.correct', 'b3', 'Correct, same session', 'fitflow/steps/implement.py:_to_correcting'),
	decision('b3.breach', 'b3', 'Scope breach remains?', 'fitflow/steps/implement.py:_end_of_budget'),
	decision('b3.ladder', 'b3', 'Role below solver?', 'fitflow/steps/implement.py:_escalate_or_stop'),
	step('b3.escalate', 'b3', 'Escalate one rung', 'fitflow/steps/implement.py:_escalate_or_stop', {
		detail: 'New assignment revision, signals unchanged, attempts reset.'
	}),
	decision(
		'b3.escalate_ok',
		'b3',
		'Escalation envelope valid?',
		'fitflow/assignment.py:validate_envelope'
	),
	step('b3.freeze', 'b3', 'Freeze slice commit', 'fitflow/steps/implement.py:_freeze', {
		detail: 'The driver commits the approved work; it is never rerun while a sibling corrects.'
	}),
	decision(
		'b3.ui_waits',
		'b3',
		'Dependent UI still to run?',
		'fitflow/steps/implement.py:_run_dependent_loops'
	),
	step(
		'b3.bring',
		'b3',
		'Merge frozen domain into UI',
		'fitflow/steps/implement.py:_bring_in_sibling',
		{
			detail: 'Pushes the merge; failing_sha becomes the merge commit.'
		}
	),
	decision('b3.bring_ok', 'b3', 'Merges cleanly?', 'fitflow/steps/implement.py:_bring_in_sibling'),
	decision(
		'b3.still_fails',
		'b3',
		'UI acceptance still fails?',
		'fitflow/steps/implement.py:_require_acceptance_still_fails'
	),
	step('b3.join', 'b3', 'Final join barrier', 'fitflow/steps/implement.py:_verify_frozen', {
		note: 'With two parallel loops, failures are collected after both settle and the first (domain, then UI) is raised.'
	}),
	decision(
		'b3.joined',
		'b3',
		'All frozen and unchanged?',
		'fitflow/steps/implement.py:_verify_frozen'
	),
	step('b3.report', 'b3', 'Report implemented', 'fitflow/steps/implement.py:_report_gate', {
		note: 'Persists terminal IMPLEMENTED; go.py ignores the return value and continues to block 4.'
	}),
	stop('b3', ['EXECUTION_HELD'], 'fitflow/runstate.py:verify_exclusive'),
	stop('b3', ['AGENT_BROKE_CONTRACT'], 'fitflow/steps/implement.py:_contract', {
		detail: 'Every block 3 stop adds the blocked label.'
	}),
	stop('b3', ['AGENT_FAILED', 'TOOL_FAILED'], 'fitflow/agents.py:talk'),
	stop('b3', ['TESTS_INVALID'], 'fitflow/steps/implement.py:_check_acceptance_is_sound'),
	stop('b3', ['CAPACITY_EXHAUSTED'], 'fitflow/steps/implement.py:_escalate_or_stop'),
	stop('b3', ['PLAN_REJECTED'], 'fitflow/steps/implement.py:_bring_in_sibling'),
	stop('b3', ['TESTS_DO_NOT_FAIL'], 'fitflow/steps/implement.py:_require_acceptance_still_fails')
];

const block3Edges: FlowEdge[] = [
	{ from: 'b3.todo', to: 'b3.dependent', label: 'yes' },
	{ from: 'b3.todo', to: 'b3.join', label: 'no' },
	{ from: 'b3.dependent', to: 'b3.entry', label: 'yes: domain first' },
	{ from: 'b3.dependent', to: 'b3.count', label: 'no' },
	{ from: 'b3.count', to: 'b3.entry', label: 'one' },
	{ from: 'b3.count', to: 'b3.entry', label: 'two, parallel' },
	{ from: 'b3.entry', to: 'b3.repair', label: 'tests_rejected' },
	{ from: 'b3.entry', to: 'b3.objection', label: 'running: retained reply' },
	{ from: 'b3.entry', to: 'b3.barrier', label: 'otherwise' },
	{ from: 'b3.barrier', to: 'b3.barrier_ok' },
	{ from: 'b3.barrier_ok', to: stopId('b3', 'EXECUTION_HELD'), label: 'lock lost' },
	{ from: 'b3.barrier_ok', to: stopId('b3', 'AGENT_BROKE_CONTRACT'), label: 'no' },
	{ from: 'b3.barrier_ok', to: 'b3.turn', label: 'yes' },
	{ from: 'b3.turn', to: 'b3.turn_ok' },
	{ from: 'b3.turn_ok', to: stopId('b3', 'AGENT_FAILED', 'TOOL_FAILED'), label: 'turn failed' },
	{ from: 'b3.turn_ok', to: stopId('b3', 'AGENT_BROKE_CONTRACT'), label: 'bad reply or session' },
	{ from: 'b3.turn_ok', to: 'b3.objection', label: 'yes' },
	{ from: 'b3.objection', to: 'b3.obj_ok', label: 'yes' },
	{ from: 'b3.objection', to: 'b3.worktree_ok', label: 'no' },
	{ from: 'b3.obj_ok', to: 'b3.budget', label: 'refused' },
	{ from: 'b3.obj_ok', to: 'b3.repairs_left', label: 'yes' },
	{ from: 'b3.repairs_left', to: stopId('b3', 'TESTS_INVALID'), label: 'no' },
	{ from: 'b3.repairs_left', to: 'b3.repair', label: 'yes' },
	{ from: 'b3.repair', to: 'b3.repair_ok' },
	{ from: 'b3.repair_ok', to: stopId('b3', 'TESTS_INVALID'), label: 'no' },
	{ from: 'b3.repair_ok', to: 'b3.refreeze', label: 'yes' },
	{ from: 'b3.refreeze', to: 'b3.barrier', label: 'relaunch' },
	{ from: 'b3.worktree_ok', to: stopId('b3', 'AGENT_BROKE_CONTRACT'), label: 'no' },
	{ from: 'b3.worktree_ok', to: 'b3.changed', label: 'yes' },
	{ from: 'b3.changed', to: 'b3.budget', label: 'no' },
	{ from: 'b3.changed', to: 'b3.bytes', label: 'yes' },
	{ from: 'b3.bytes', to: stopId('b3', 'AGENT_BROKE_CONTRACT'), label: 'no' },
	{ from: 'b3.bytes', to: 'b3.scope', label: 'yes' },
	{ from: 'b3.scope', to: 'b3.budget', label: 'no' },
	{ from: 'b3.scope', to: 'b3.accept', label: 'yes' },
	{ from: 'b3.accept', to: 'b3.passes' },
	{ from: 'b3.passes', to: 'b3.test_broken', label: 'no' },
	{ from: 'b3.passes', to: 'b3.gates', label: 'yes' },
	{ from: 'b3.test_broken', to: stopId('b3', 'TESTS_INVALID'), label: 'yes' },
	{ from: 'b3.test_broken', to: 'b3.budget', label: 'no' },
	{ from: 'b3.gates', to: 'b3.green' },
	{ from: 'b3.green', to: 'b3.freeze', label: 'yes' },
	{ from: 'b3.green', to: 'b3.flake', label: 'no' },
	{ from: 'b3.flake', to: 'b3.rerun', label: 'yes' },
	{ from: 'b3.flake', to: 'b3.blame', label: 'no' },
	{ from: 'b3.rerun', to: 'b3.solo' },
	{ from: 'b3.solo', to: 'b3.freeze', label: 'yes: local flake' },
	{ from: 'b3.solo', to: 'b3.blame', label: 'no' },
	{ from: 'b3.blame', to: stopId('b3', 'TESTS_INVALID'), label: 'yes' },
	{ from: 'b3.blame', to: 'b3.budget', label: 'no' },
	{ from: 'b3.budget', to: 'b3.correct', label: 'yes' },
	{ from: 'b3.correct', to: 'b3.barrier' },
	{ from: 'b3.budget', to: 'b3.breach', label: 'no' },
	{ from: 'b3.breach', to: stopId('b3', 'AGENT_BROKE_CONTRACT'), label: 'yes' },
	{ from: 'b3.breach', to: 'b3.ladder', label: 'no' },
	{ from: 'b3.ladder', to: stopId('b3', 'CAPACITY_EXHAUSTED'), label: 'no: solver' },
	{ from: 'b3.ladder', to: 'b3.escalate', label: 'yes' },
	{ from: 'b3.escalate', to: 'b3.escalate_ok' },
	{ from: 'b3.escalate_ok', to: stopId('b3', 'PLAN_REJECTED'), label: 'no' },
	{ from: 'b3.escalate_ok', to: 'b3.barrier', label: 'yes' },
	{ from: 'b3.freeze', to: 'b3.ui_waits' },
	{ from: 'b3.ui_waits', to: 'b3.bring', label: 'yes' },
	{ from: 'b3.ui_waits', to: 'b3.join', label: 'no' },
	{ from: 'b3.bring', to: 'b3.bring_ok' },
	{ from: 'b3.bring_ok', to: stopId('b3', 'PLAN_REJECTED'), label: 'no' },
	{ from: 'b3.bring_ok', to: 'b3.still_fails', label: 'yes' },
	{ from: 'b3.still_fails', to: stopId('b3', 'TESTS_DO_NOT_FAIL'), label: 'no' },
	{ from: 'b3.still_fails', to: 'b3.entry', label: 'yes: UI loop' },
	{ from: 'b3.join', to: 'b3.joined' },
	{ from: 'b3.joined', to: stopId('b3', 'CAPACITY_EXHAUSTED'), label: 'a slice failed' },
	{ from: 'b3.joined', to: stopId('b3', 'AGENT_BROKE_CONTRACT'), label: 'commit moved' },
	{ from: 'b3.joined', to: 'b3.report', label: 'yes' },
	{ from: 'b3.report', to: 'b4.settle' }
];

// --- Block 4: deliver ---------------------------------------------------------

const block4: FlowNode[] = [
	step(
		'b4.settle',
		'b4',
		'Settle interrupted fixes',
		'fitflow/steps/deliver.py:_settle_interrupted_fixes',
		{
			note: 'Does work only on a resumed run that stopped inside a fix turn.'
		}
	),
	decision('b4.frozen', 'b4', 'Slices still frozen?', 'fitflow/steps/implement.py:verify_frozen'),
	decision(
		'b4.recorded',
		'b4',
		'Integration branch recorded?',
		'fitflow/steps/deliver.py:_integrate'
	),
	decision(
		'b4.intact',
		'b4',
		'Retained branch intact?',
		'fitflow/steps/deliver.py:_retained_integration'
	),
	decision('b4.exists', 'b4', 'Branch or worktree exists?', 'fitflow/steps/deliver.py:_integrate'),
	step('b4.integrate', 'b4', 'Merge frozen slices', 'fitflow/steps/deliver.py:_integrate', {
		detail: "Integration branch from main, each slice's frozen commit merged in record order."
	}),
	decision('b4.merges', 'b4', 'Merges cleanly?', 'fitflow/steps/deliver.py:_merge_or_reject'),
	step('b4.pr', 'b4', 'Push, open PR', 'fitflow/steps/deliver.py:_open_pr', {
		detail: 'Body ends "Closes #N". A retained PR number is reused.'
	}),
	step('b4.rejoin', 'b4', 'Rejoin settled fixes', 'fitflow/steps/deliver.py:_rejoin_fixes'),
	decision('b4.mechanical', 'b4', 'Mechanical change?', 'fitflow/review.py:is_mechanical', {
		detail: "Every slice's final signals still select row 4."
	}),
	decision('b4.kept', 'b4', 'Merge verdict retained?', 'fitflow/steps/deliver.py:_deliver'),
	step('b4.review', 'b4', 'Reviewer turn', 'fitflow/steps/deliver.py:_reviewer_turn', {
		detail: 'Read-only reviewer on the integration head; findings must cite the diff.'
	}),
	decision(
		'b4.review_ok',
		'b4',
		'Valid read-only reply?',
		'fitflow/steps/deliver.py:_reviewer_turn',
		{
			detail:
				'Invalid replies retry up to turns.BUDGET; a worktree the reviewer changed is a contract breach.'
		}
	),
	decision('b4.verdict', 'b4', 'Verdict?', 'fitflow/steps/deliver.py:_review_loop'),
	decision('b4.closing', 'b4', 'Fix rounds left?', 'fitflow/review.py:is_closing', {
		detail: '_MAX_REVIEW_ROUNDS = 2; every fix round is followed by a review, the last one closing.'
	}),
	step(
		'b4.hand_review',
		'b4',
		'Hand review to Gabriel',
		'fitflow/steps/deliver.py:_stop_for_gabriel'
	),
	step('b4.fix', 'b4', 'Fix turns in slices', 'fitflow/steps/deliver.py:_apply_fixes', {
		detail: 'Findings routed to owning slices; implement.review_fix_turn, re-freeze, rejoin, push.'
	}),
	decision('b4.fix_ok', 'b4', 'Fixes landed?', 'fitflow/steps/deliver.py:_apply_fixes'),
	step('b4.checks', 'b4', 'Read PR checks', 'fitflow/steps/deliver.py:_claims'),
	decision('b4.state', 'b4', 'Checks state?', 'fitflow/steps/deliver.py:_claims', {
		detail: 'A failed job while others still run is treated as pending.'
	}),
	step('b4.wait', 'b4', 'Wait for checks', 'fitflow/steps/deliver.py:_await_checks'),
	decision('b4.timeout', 'b4', 'Past CI timeout?', 'fitflow/steps/deliver.py:_await_checks'),
	step('b4.diagnose', 'b4', 'Read failed job log', 'fitflow/ci_log.py:diagnose'),
	decision('b4.owned', 'b4', 'Log blames a slice file?', 'fitflow/steps/deliver.py:_ci_findings'),
	decision(
		'b4.only_tests',
		'b4',
		'Only acceptance tests?',
		'fitflow/steps/deliver.py:_ci_findings'
	),
	decision('b4.ci_left', 'b4', 'CI fix rounds left?', 'fitflow/steps/deliver.py:_ci_fix_round', {
		detail: '_MAX_CI_FIX_ROUNDS = 2, counted in the run record.'
	}),
	step('b4.ci_fix', 'b4', 'CI fix turns in slices', 'fitflow/steps/deliver.py:_ci_fix_round'),
	decision('b4.rerun_used', 'b4', 'Rerun already used?', 'fitflow/steps/deliver.py:_rerun_or_stop'),
	step('b4.rerun', 'b4', 'Rerun failed jobs once', 'fitflow/steps/deliver.py:_rerun'),
	decision(
		'b4.required',
		'b4',
		'Required check SUCCESS?',
		'fitflow/steps/deliver.py:_require_all_green'
	),
	decision(
		'b4.driver',
		'b4',
		'Diff touches workflow/?',
		'fitflow/steps/deliver.py:_withhold_driver_merge'
	),
	step(
		'b4.hand_merge',
		'b4',
		'Hand merge to Gabriel',
		'fitflow/steps/deliver.py:_hand_merge_to_gabriel',
		{
			detail: 'PR left open and green, worktrees kept, never blocked.'
		}
	),
	step('b4.merge', 'b4', 'Merge via queue', 'fitflow/steps/deliver.py:_merge'),
	decision('b4.merged', 'b4', 'Merged in time?', 'fitflow/steps/deliver.py:_merge', {
		detail: 'The PR must be OPEN before the merge and reach MERGED within CI_TIMEOUT.'
	}),
	step('b4.report', 'b4', 'Report delivered', 'fitflow/steps/deliver.py:_report_gate', {
		note: 'Persists terminal DELIVERED; go.py continues to block 5.'
	}),
	stop('b4', ['CAPACITY_EXHAUSTED'], 'fitflow/steps/deliver.py:_review_loop', {
		detail: 'Block 4 stops add the blocked label, except NEEDS_GABRIEL.'
	}),
	stop('b4', ['AGENT_BROKE_CONTRACT'], 'fitflow/steps/deliver.py:_verify_read_only'),
	stop('b4', ['RUN_STATE_CONFLICT'], 'fitflow/steps/deliver.py:_retained_integration'),
	stop('b4', ['WORKTREE_EXISTS'], 'fitflow/steps/deliver.py:_integrate'),
	stop('b4', ['PLAN_REJECTED'], 'fitflow/steps/deliver.py:_merge_or_reject'),
	stop('b4', ['TOOL_FAILED'], 'fitflow/steps/deliver.py:_deliver'),
	stop('b4', ['TESTS_INVALID'], 'fitflow/steps/deliver.py:_stop_on_acceptance_culprits'),
	stop('b4', ['NEEDS_GABRIEL'], 'fitflow/steps/deliver.py:_hand_merge_to_gabriel')
];

const block4Edges: FlowEdge[] = [
	{ from: 'b4.settle', to: 'b4.frozen' },
	{ from: 'b4.frozen', to: stopId('b4', 'CAPACITY_EXHAUSTED'), label: 'a slice failed' },
	{ from: 'b4.frozen', to: stopId('b4', 'AGENT_BROKE_CONTRACT'), label: 'commit moved' },
	{ from: 'b4.frozen', to: 'b4.recorded', label: 'yes' },
	{ from: 'b4.recorded', to: 'b4.intact', label: 'yes' },
	{ from: 'b4.recorded', to: 'b4.exists', label: 'no' },
	{ from: 'b4.intact', to: stopId('b4', 'RUN_STATE_CONFLICT'), label: 'no' },
	{ from: 'b4.intact', to: 'b4.pr', label: 'yes' },
	{ from: 'b4.exists', to: stopId('b4', 'WORKTREE_EXISTS'), label: 'yes' },
	{ from: 'b4.exists', to: 'b4.integrate', label: 'no' },
	{ from: 'b4.integrate', to: 'b4.merges' },
	{ from: 'b4.merges', to: stopId('b4', 'PLAN_REJECTED'), label: 'conflict' },
	{ from: 'b4.merges', to: stopId('b4', 'TOOL_FAILED'), label: 'not an ancestor' },
	{ from: 'b4.merges', to: 'b4.pr', label: 'yes' },
	{ from: 'b4.pr', to: 'b4.rejoin' },
	{ from: 'b4.rejoin', to: 'b4.mechanical' },
	{ from: 'b4.mechanical', to: 'b4.checks', label: 'yes' },
	{ from: 'b4.mechanical', to: 'b4.kept', label: 'no' },
	{ from: 'b4.kept', to: 'b4.checks', label: 'yes' },
	{ from: 'b4.kept', to: 'b4.review', label: 'no' },
	{ from: 'b4.review', to: 'b4.review_ok' },
	{ from: 'b4.review_ok', to: stopId('b4', 'TOOL_FAILED'), label: 'invalid' },
	{ from: 'b4.review_ok', to: stopId('b4', 'AGENT_BROKE_CONTRACT'), label: 'wrote' },
	{ from: 'b4.review_ok', to: 'b4.verdict', label: 'yes' },
	{ from: 'b4.verdict', to: 'b4.checks', label: 'merge' },
	{ from: 'b4.verdict', to: 'b4.closing', label: 'fix' },
	{ from: 'b4.closing', to: 'b4.hand_review', label: 'no' },
	{ from: 'b4.hand_review', to: stopId('b4', 'CAPACITY_EXHAUSTED') },
	{ from: 'b4.closing', to: 'b4.fix', label: 'yes' },
	{ from: 'b4.fix', to: 'b4.fix_ok' },
	{ from: 'b4.fix_ok', to: stopId('b4', 'CAPACITY_EXHAUSTED'), label: 'fix budget spent' },
	{ from: 'b4.fix_ok', to: stopId('b4', 'PLAN_REJECTED'), label: 'conflict' },
	{ from: 'b4.fix_ok', to: 'b4.review', label: 'yes: re-review' },
	{ from: 'b4.checks', to: 'b4.state' },
	{ from: 'b4.state', to: 'b4.wait', label: 'pending' },
	{ from: 'b4.state', to: 'b4.diagnose', label: 'red' },
	{ from: 'b4.state', to: 'b4.required', label: 'green' },
	{ from: 'b4.wait', to: 'b4.timeout' },
	{ from: 'b4.timeout', to: stopId('b4', 'TOOL_FAILED'), label: 'yes' },
	{ from: 'b4.timeout', to: 'b4.checks', label: 'no' },
	{ from: 'b4.diagnose', to: 'b4.owned' },
	{ from: 'b4.owned', to: 'b4.rerun_used', label: 'no' },
	{ from: 'b4.owned', to: 'b4.only_tests', label: 'yes' },
	{ from: 'b4.only_tests', to: stopId('b4', 'TESTS_INVALID'), label: 'yes' },
	{ from: 'b4.only_tests', to: 'b4.ci_left', label: 'no' },
	{ from: 'b4.ci_left', to: stopId('b4', 'CAPACITY_EXHAUSTED'), label: 'no' },
	{ from: 'b4.ci_left', to: 'b4.ci_fix', label: 'yes' },
	{ from: 'b4.ci_fix', to: 'b4.checks', label: 'push, await' },
	{ from: 'b4.rerun_used', to: stopId('b4', 'CAPACITY_EXHAUSTED'), label: 'yes' },
	{ from: 'b4.rerun_used', to: 'b4.rerun', label: 'no' },
	{ from: 'b4.rerun', to: 'b4.checks' },
	{ from: 'b4.required', to: stopId('b4', 'TOOL_FAILED'), label: 'no' },
	{ from: 'b4.required', to: 'b4.driver', label: 'yes' },
	{ from: 'b4.driver', to: 'b4.hand_merge', label: 'yes' },
	{ from: 'b4.hand_merge', to: stopId('b4', 'NEEDS_GABRIEL') },
	{ from: 'b4.driver', to: 'b4.merge', label: 'no' },
	{ from: 'b4.merge', to: 'b4.merged' },
	{ from: 'b4.merged', to: stopId('b4', 'TOOL_FAILED'), label: 'no' },
	{ from: 'b4.merged', to: 'b4.report', label: 'yes' },
	{ from: 'b4.report', to: 'b5.sha' }
];

// --- Block 5: ship ------------------------------------------------------------

const block5: FlowNode[] = [
	step('b5.sha', 'b5', 'Read merge commit', 'fitflow/steps/ship.py:_merge_sha'),
	decision('b5.sha_ok', 'b5', 'Merge commit known?', 'fitflow/steps/ship.py:_merge_sha'),
	step('b5.tag', 'b5', 'Await version tag', 'fitflow/steps/ship.py:_await_tag', {
		detail: 'A v* tag from version-tag.yml pointing at the merge commit.'
	}),
	decision('b5.tagged', 'b5', 'Tagged in time?', 'fitflow/steps/ship.py:_await_tag'),
	step('b5.main_ci', 'b5', 'Read main CI runs', 'fitflow/steps/ship.py:_await_main_ci', {
		detail: 'A green push run on main, or a green merge_group run for the commit.'
	}),
	decision('b5.ci', 'b5', 'Main CI verdict?', 'fitflow/steps/ship.py:_refuse_or_wait'),
	decision('b5.ship_to', 'b5', 'FIT_FLOW_SHIP_TO?', 'fitflow/steps/ship.py:_ship'),
	step('b5.skip', 'b5', 'Record deploys skipped', 'fitflow/steps/ship.py:_skip_deploy'),
	step('b5.release', 'b5', 'Release worktree at merge', 'fitflow/steps/ship.py:_release_worktree'),
	decision(
		'b5.release_ok',
		'b5',
		'Release worktree clean?',
		'fitflow/steps/ship.py:_release_worktree'
	),
	step('b5.qa', 'b5', 'Deploy to QA', 'fitflow/steps/ship.py:_deploy', {
		detail:
			'bun run deploy --tunnel; recorded as started first. A retained smoke-verified deploy is skipped on resume.'
	}),
	decision('b5.qa_ok', 'b5', 'QA smoke ok?', 'fitflow/steps/ship.py:_verdict'),
	step('b5.flaky', 'b5', 'Decide flaky', 'fitflow/steps/ship.py:_flaky', {
		detail:
			"Flaky when block 4 reran an End-to-end job, or main's push run is not green. Awaited only when prod is the target."
	}),
	decision('b5.to_prod', 'b5', 'Ship to prod?', 'fitflow/settings.py:ship_config'),
	decision('b5.is_flaky', 'b5', 'Flaky signal?', 'fitflow/steps/ship.py:_ship'),
	step('b5.prod', 'b5', 'Deploy to production', 'fitflow/steps/ship.py:_deploy'),
	decision('b5.prod_ok', 'b5', 'Prod smoke ok?', 'fitflow/steps/ship.py:_verdict'),
	step('b5.hand', 'b5', 'Label needs-gabriel', 'fitflow/steps/ship.py:_hand_to_gabriel', {
		detail: 'Nothing is rolled back.'
	}),
	decision('b5.android', 'b5', 'Prod live, Android on?', 'fitflow/steps/ship.py:_android'),
	step('b5.apk', 'b5', 'Build and keep APK', 'fitflow/steps/ship.py:_android', {
		detail: 'bun run android:release; APK kept under FIT_FLOW_HOME/releases/<tag> and re-hashed.'
	}),
	decision('b5.apk_ok', 'b5', 'APK kept and hashed?', 'fitflow/steps/ship.py:_keep_apk'),
	step('b5.cleanup', 'b5', 'Clean up, close children', 'fitflow/steps/ship.py:_cleanup', {
		detail:
			'worktree:done per slice, integration and release; remote branches deleted once landed; children closed; in-progress removed.'
	}),
	step('b5.report', 'b5', 'Report shipped', 'fitflow/steps/ship.py:_report_gate'),
	decision('b5.deferred', 'b5', 'Deferred failures?', 'fitflow/steps/ship.py:run', {
		detail: 'Android or cleanup failures are reported before they stop the run.'
	}),
	stop('b5', ['TOOL_FAILED'], 'fitflow/steps/ship.py:_stop'),
	stop('b5', ['WORKTREE_EXISTS'], 'fitflow/steps/ship.py:_release_worktree'),
	stop('b5', ['DEPLOY_FAILED'], 'fitflow/steps/ship.py:_deploy'),
	success('b5', 'SHIPPED', 'fitflow/steps/ship.py:run', {
		detail: 'Exit 0. PLANNED, IMPLEMENTED and DELIVERED are aliases of the same code.'
	})
];

const block5Edges: FlowEdge[] = [
	{ from: 'b5.sha', to: 'b5.sha_ok' },
	{ from: 'b5.sha_ok', to: stopId('b5', 'TOOL_FAILED'), label: 'no' },
	{ from: 'b5.sha_ok', to: 'b5.tag', label: 'yes' },
	{ from: 'b5.tag', to: 'b5.tagged' },
	{ from: 'b5.tagged', to: stopId('b5', 'TOOL_FAILED'), label: 'no' },
	{ from: 'b5.tagged', to: 'b5.main_ci', label: 'yes' },
	{ from: 'b5.main_ci', to: 'b5.ci' },
	{ from: 'b5.ci', to: 'b5.main_ci', label: 'pending: wait' },
	{ from: 'b5.ci', to: stopId('b5', 'TOOL_FAILED'), label: 'none, red or timeout' },
	{ from: 'b5.ci', to: 'b5.ship_to', label: 'green' },
	{ from: 'b5.ship_to', to: 'b5.skip', label: 'none' },
	{ from: 'b5.skip', to: 'b5.cleanup' },
	{ from: 'b5.ship_to', to: 'b5.release', label: 'qa or prod' },
	{ from: 'b5.release', to: 'b5.release_ok' },
	{ from: 'b5.release_ok', to: stopId('b5', 'WORKTREE_EXISTS'), label: 'stale one' },
	{ from: 'b5.release_ok', to: stopId('b5', 'TOOL_FAILED'), label: 'wrong head or dirty' },
	{ from: 'b5.release_ok', to: 'b5.qa', label: 'yes' },
	{ from: 'b5.qa', to: 'b5.qa_ok' },
	{ from: 'b5.qa_ok', to: 'b5.hand', label: 'no' },
	{ from: 'b5.qa_ok', to: 'b5.flaky', label: 'yes' },
	{ from: 'b5.flaky', to: 'b5.to_prod' },
	{ from: 'b5.to_prod', to: 'b5.android', label: 'no: qa' },
	{ from: 'b5.to_prod', to: 'b5.is_flaky', label: 'yes' },
	{ from: 'b5.is_flaky', to: 'b5.android', label: 'yes: prod waits' },
	{ from: 'b5.is_flaky', to: 'b5.prod', label: 'no' },
	{ from: 'b5.prod', to: 'b5.prod_ok' },
	{ from: 'b5.prod_ok', to: 'b5.hand', label: 'no' },
	{ from: 'b5.prod_ok', to: 'b5.android', label: 'yes' },
	{ from: 'b5.hand', to: stopId('b5', 'DEPLOY_FAILED') },
	{ from: 'b5.android', to: 'b5.cleanup', label: 'no: skipped' },
	{ from: 'b5.android', to: 'b5.apk', label: 'yes' },
	{ from: 'b5.apk', to: 'b5.apk_ok' },
	{ from: 'b5.apk_ok', to: 'b5.cleanup', label: 'no: deferred' },
	{ from: 'b5.apk_ok', to: 'b5.cleanup', label: 'yes' },
	{ from: 'b5.cleanup', to: 'b5.report' },
	{ from: 'b5.report', to: 'b5.deferred' },
	{ from: 'b5.deferred', to: stopId('b5', 'TOOL_FAILED'), label: 'yes' },
	{ from: 'b5.deferred', to: 'b5.done.SHIPPED', label: 'no' }
];

// --- Resume lane --------------------------------------------------------------

const resume: FlowNode[] = [
	entry('r.start', 'resume', 'go.py N --resume', 'go.py:resume'),
	step('r.sync', 'resume', 'Fetch origin', 'fitflow/steps/sync.py:sync'),
	step('r.view', 'resume', 'View issue', 'fitflow/steps/pick.py:pick_for_resume'),
	decision(
		'r.pickable',
		'resume',
		'Story, no human hold?',
		'fitflow/steps/pick.py:pick_for_resume',
		{
			detail: "in-progress and blocked are the run's own marks and do not stop a resume."
		}
	),
	decision('r.lock', 'resume', 'Story lock free?', 'fitflow/runstate.py:story_lock'),
	decision('r.record', 'resume', 'Record readable?', 'fitflow/runstate.py:load_run'),
	decision('r.shipped', 'resume', 'Already shipped?', 'fitflow/steps/resume.py:reconcile'),
	decision('r.pr', 'resume', 'PR state?', 'fitflow/steps/resume.py:_pr_merged'),
	decision('r.open', 'resume', 'Story open?', 'fitflow/steps/resume.py:reconcile'),
	step('r.take', 'resume', 'Take the story back', 'fitflow/steps/resume.py:_take_back', {
		detail: 'Drops blocked, re-adds in-progress. Also done on the merged-PR path.'
	}),
	decision('r.block1', 'resume', 'Tests not all frozen?', 'fitflow/steps/resume.py:_in_block1'),
	decision(
		'r.unassigned',
		'resume',
		'A slice unassigned?',
		'fitflow/steps/resume.py:_before_block3'
	),
	decision(
		'r.launched',
		'resume',
		'Any turn launched?',
		'fitflow/steps/resume.py:_require_never_launched'
	),
	step('r.context', 'resume', 'Re-gather issue context', 'fitflow/issue_context.py:prepare', {
		note: 'go.py:resume at stage DELEGATE; block 2 then runs decide_and_launch on the retained record, without begin_run.'
	}),
	step('r.slices', 'resume', 'Reconcile each slice', 'fitflow/steps/resume.py:_reconcile_slice', {
		detail:
			'A running turn is voided, a replied turn re-validated from its bytes, a test repair or review fix reopened.'
	}),
	decision(
		'r.slice_ok',
		'resume',
		'Honestly resumable?',
		'fitflow/steps/resume.py:_reconcile_slice'
	),
	decision('r.after', 'resume', 'Stage after block 3?', 'fitflow/steps/resume.py:_after_block3'),
	stop('resume', ['CANNOT_PICK'], 'fitflow/steps/resume.py:reconcile'),
	stop('resume', ['EXECUTION_HELD'], 'fitflow/runstate.py:story_lock'),
	stop('resume', ['RUN_STATE_CONFLICT'], 'fitflow/steps/resume.py:_conflict')
];

const resumeEdges: FlowEdge[] = [
	{ from: 'r.start', to: 'r.sync' },
	{ from: 'r.sync', to: 'r.view' },
	{ from: 'r.view', to: 'r.pickable' },
	{ from: 'r.pickable', to: stopId('resume', 'CANNOT_PICK'), label: 'no' },
	{ from: 'r.pickable', to: 'r.lock', label: 'yes' },
	{ from: 'r.lock', to: stopId('resume', 'EXECUTION_HELD'), label: 'no' },
	{ from: 'r.lock', to: 'r.record', label: 'yes' },
	{ from: 'r.record', to: stopId('resume', 'CANNOT_PICK'), label: 'none retained' },
	{ from: 'r.record', to: stopId('resume', 'RUN_STATE_CONFLICT'), label: 'unreadable' },
	{ from: 'r.record', to: 'r.shipped', label: 'yes' },
	{ from: 'r.shipped', to: stopId('resume', 'CANNOT_PICK'), label: 'yes' },
	{ from: 'r.shipped', to: 'r.pr', label: 'no' },
	{ from: 'r.pr', to: 'b5.sha', label: 'MERGED → SHIP' },
	{ from: 'r.pr', to: stopId('resume', 'RUN_STATE_CONFLICT'), label: 'closed' },
	{ from: 'r.pr', to: 'r.open', label: 'open or none' },
	{ from: 'r.open', to: stopId('resume', 'CANNOT_PICK'), label: 'no' },
	{ from: 'r.open', to: 'r.take', label: 'yes' },
	{ from: 'r.take', to: 'r.block1' },
	{ from: 'r.block1', to: 'b1.pending', label: 'WRITE_TESTS' },
	{ from: 'r.block1', to: 'r.unassigned', label: 'no' },
	{ from: 'r.unassigned', to: 'r.launched', label: 'yes' },
	{ from: 'r.launched', to: stopId('resume', 'RUN_STATE_CONFLICT'), label: 'yes' },
	{ from: 'r.launched', to: 'r.context', label: 'no' },
	{ from: 'r.context', to: 'b2.signals', label: 'DELEGATE' },
	{ from: 'r.unassigned', to: 'r.slices', label: 'no' },
	{ from: 'r.slices', to: 'r.slice_ok' },
	{ from: 'r.slice_ok', to: stopId('resume', 'RUN_STATE_CONFLICT'), label: 'no' },
	{ from: 'r.slice_ok', to: stopId('resume', 'EXECUTION_HELD'), label: 'turn still live' },
	{ from: 'r.slice_ok', to: 'r.after', label: 'yes' },
	{ from: 'r.after', to: 'b3.todo', label: 'IMPLEMENT' },
	{ from: 'r.after', to: 'b4.settle', label: 'DELIVER' }
];

// --- Reset lane ---------------------------------------------------------------

const reset: FlowNode[] = [
	entry('x.start', 'reset', 'go.py N --reset', 'go.py:reset'),
	step('x.view', 'reset', 'View issue', 'fitflow/steps/reset.py:run'),
	decision('x.exists', 'reset', 'Issue exists?', 'fitflow/steps/reset.py:run'),
	decision('x.lock', 'reset', 'Story lock free?', 'fitflow/runstate.py:story_lock'),
	step('x.undo', 'reset', 'Close PR, remove worktrees', 'fitflow/steps/reset.py:run', {
		detail:
			'Closes an open PR, removes worktrees and local/remote branches, deletes teams. Works by name when no record is retained.'
	}),
	step(
		'x.labels',
		'reset',
		'Close children, drop labels',
		'fitflow/steps/reset.py:_release_labels',
		{
			detail: 'Closes child issues; drops in-progress and blocked.'
		}
	),
	step('x.archive', 'reset', 'Archive record, comment', 'fitflow/runstate.py:archive_run'),
	stop('reset', ['CANNOT_PICK'], 'fitflow/steps/reset.py:run'),
	stop('reset', ['EXECUTION_HELD'], 'fitflow/runstate.py:story_lock'),
	success('reset', 'RESET', 'fitflow/steps/reset.py:run', { detail: 'Exit 0.' })
];

const resetEdges: FlowEdge[] = [
	{ from: 'x.start', to: 'x.view' },
	{ from: 'x.view', to: 'x.exists' },
	{ from: 'x.exists', to: stopId('reset', 'CANNOT_PICK'), label: 'no' },
	{ from: 'x.exists', to: 'x.lock', label: 'yes' },
	{ from: 'x.lock', to: stopId('reset', 'EXECUTION_HELD'), label: 'no' },
	{ from: 'x.lock', to: 'x.undo', label: 'yes' },
	{ from: 'x.undo', to: 'x.labels' },
	{ from: 'x.labels', to: 'x.archive' },
	{ from: 'x.archive', to: 'reset.done.RESET' }
];

export const nodes: FlowNode[] = [
	...block1,
	...block2,
	...block3,
	...block4,
	...block5,
	...resume,
	...reset
];

export const edges: FlowEdge[] = [
	...block1Edges,
	...block2Edges,
	...block3Edges,
	...block4Edges,
	...block5Edges,
	...resumeEdges,
	...resetEdges
];

/** Structural problems in the graph; empty when it is consistent. */
export function graphProblems(graph = { nodes, edges }): string[] {
	const problems: string[] = [];
	const ids = new Set<string>();
	for (const node of graph.nodes) {
		if (ids.has(node.id)) problems.push(`duplicate node id ${node.id}`);
		ids.add(node.id);
	}
	const outgoing = new Map<string, number>();
	const incoming = new Map<string, number>();
	for (const edge of graph.edges) {
		if (!ids.has(edge.from)) problems.push(`edge from unknown node ${edge.from}`);
		if (!ids.has(edge.to)) problems.push(`edge to unknown node ${edge.to}`);
		outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
		incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
	}
	for (const node of graph.nodes) {
		const out = outgoing.get(node.id) ?? 0;
		if (node.kind === 'decision' && out < 2) problems.push(`decision ${node.id} has ${out} exits`);
		if (node.kind === 'terminal' && node.tone !== 'entry' && out > 0)
			problems.push(`terminal ${node.id} has exits`);
		if (node.tone !== 'entry' && (incoming.get(node.id) ?? 0) === 0)
			problems.push(`node ${node.id} is unreachable`);
	}
	return problems;
}
