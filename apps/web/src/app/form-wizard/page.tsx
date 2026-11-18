// Copyright (c) Meta Platforms, Inc. and affiliates.

'use client';

/**
 * A create-workspace flow: four steps, a horizontal Stepper, per-step
 * validation, and a review step that summarises every answer before anything
 * is written.
 *
 * The horizontal orientation is the right default when a wizard owns the whole
 * page and the steps are short nouns. It reads as a progress bar with names,
 * costs one row of vertical space, and leaves the full content column for the
 * form. Reach for the vertical orientation instead when step labels need
 * descriptions to be understood, or when the wizard shares its width with
 * something else.
 *
 * Three pieces of state drive the whole flow: `step` (which panel is showing),
 * the field values, and `attempted` (which steps the user has tried to leave).
 * Validation is a pure function of the field values, so the same `errors`
 * object gates the Next button, colors the Stepper, and fills the review
 * step's issue list — there is no second copy of the rules to drift.
 *
 * ## Extending this template
 *
 * **Validate on leave, not on keystroke.** `attempted` exists so a field that
 * has never been filled in is not already red. A step joins the set when the
 * user presses Next on it, which is the first moment they have asserted it is
 * done. Everything downstream reads `attempted`, so a new field inherits the
 * behavior by being added to `validate` — do not add a per-field touched flag.
 *
 * **Let people move backward freely.** `onStepClick` is passed unconditionally,
 * so every step is reachable at any time. A wizard that locks you out of step 1
 * because step 3 is invalid turns a typo into a restart. Forward movement is
 * still gated by the footer button; the stepper is an escape hatch, not the
 * primary path.
 *
 * **`status` is color, not progress.** A Step derives completed/current/upcoming
 * from its index against `activeStep`; `status="error"` only tints it. That is
 * why a step can read as completed and still show an error — which is exactly
 * what you want when someone skips ahead and leaves something broken behind.
 *
 * **Keep the review step derived.** Every row in the summary reads the same
 * state the inputs write. Never copy answers into a separate summary object on
 * Next: the copy is what goes stale when someone jumps back and edits.
 *
 * **One panel, one step.** The content region swaps its contents rather than
 * stacking every step in a scrolling page. If a step grows past roughly a
 * screen, that is the signal it is two steps, not the signal to scroll harder.
 *
 * **The step is not in a Card.** The pinned header and footer already fence
 * this region; a card inside them is a second border and, worse, a second
 * inset — its padding would push every field off the line the title and the
 * stepper sit on.
 */

import {useMemo, useRef, useState, type CSSProperties} from 'react';
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {Divider} from '@astryxdesign/core/Divider';
import {FileInput} from '@astryxdesign/core/FileInput';
import {FormLayout} from '@astryxdesign/core/FormLayout';
import {
  Layout,
  LayoutContent,
  LayoutFooter,
  LayoutHeader,
} from '@astryxdesign/core/Layout';
import {MetadataList, MetadataListItem} from '@astryxdesign/core/MetadataList';
import {RadioList, RadioListItem} from '@astryxdesign/core/RadioList';
import {Selector} from '@astryxdesign/core/Selector';
import {HStack, StackItem, VStack} from '@astryxdesign/core/Stack';
import {Step, Stepper} from '@astryxdesign/core/Stepper';
import {Heading, Text} from '@astryxdesign/core/Text';
import {TextArea} from '@astryxdesign/core/TextArea';
import {TextInput} from '@astryxdesign/core/TextInput';
import {useMediaQuery} from '@astryxdesign/core/hooks';
import {emailAddress, titleInput, workspaceDocumentLimit, workspaceProject, workspaceSlug, workspaceStatuses} from '@clausid/contracts';
import type {Workspace} from '@clausid/contracts';
import {ApiError, errorMessage, workspaceAction, workspaceApi} from '../../api.ts';

// ── Data ──────────────────────────────────────────────────────────────────────

const STEPS = ['Workspace', 'Team', 'Document', 'Review'];

const REGIONS = [
  {value: 'us-east', label: 'US East (N. Virginia)'},
  {value: 'us-west', label: 'US West (Oregon)'},
  {value: 'eu-central', label: 'EU Central (Frankfurt)'},
  {value: 'ap-southeast', label: 'Asia Pacific (Singapore)'},
];

// Reserved slugs the backend would reject; checked client-side so the user
// finds out while typing rather than after pressing Create.
const TAKEN_SLUGS = ['admin', 'app', 'api', 'northwind', 'support'];

// ── Styles ────────────────────────────────────────────────────────────────────
// Plain inline styles over Astryx token CSS variables, so the template compiles
// in a project with no StyleX pipeline.

// The footer's two end zones divide the leftover space equally rather than
// sizing to their own contents, which is what keeps the step counter on the
// page's centre line. Without the zero basis the counter drifts by half the
// difference between the zones — most visibly on the last step, where the
// primary button's label grows from "Next" to "Create workspace".
const footerZone: CSSProperties = {flexBasis: 0};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Split a textarea of addresses on newlines and commas, dropping blanks. */
function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map(line => line.trim())
    .filter(Boolean);
}

export default function FormWizardPage({ workspace }: { workspace?: Workspace }) {
  const editing = workspace !== undefined;
  const wizardTitle = editing ? 'Edit workspace' : 'Create workspace';
  const isNarrow = useMediaQuery('(max-width: 640px)');

  // Focus targets for every field `validate` can complain about, keyed by the
  // same names it uses. Pressing Next on a blocked step sends focus to the
  // first of these that has a problem, which scrolls it into view and lets the
  // field's own error announce itself — so the footer needs no summary line,
  // and there is no second copy of the message to keep in sync.
  const fieldRefs = {
    name: useRef<HTMLInputElement>(null),
    project: useRef<HTMLInputElement>(null),
    description: useRef<HTMLTextAreaElement>(null),
    slug: useRef<HTMLInputElement>(null),
    invites: useRef<HTMLTextAreaElement>(null),
    document: useRef<HTMLInputElement>(null),
    terms: useRef<HTMLInputElement>(null),
  };

  const [step, setStep] = useState(0);
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [takenSlug, setTakenSlug] = useState('');
  // Steps the user has tried to advance past. Errors stay silent until a step
  // is in this set, so an untouched field is never pre-flagged red.
  const [attempted, setAttempted] = useState<ReadonlySet<number>>(new Set());

  // Step 1 — workspace
  const [name, setName] = useState(workspace?.name ?? '');
  const [project, setProject] = useState(workspace?.project ?? '');
  const [description, setDescription] = useState(workspace?.description ?? '');
  const [status, setStatus] = useState(workspace?.status);
  const [slug, setSlug] = useState(workspace?.slug ?? '');
  const workspaceURL = workspace?.slug
    ? '/?workspaceSlug=' + encodeURIComponent(workspace.slug)
    : workspace ? '/?workspace=' + workspace.id : '';
  const [region, setRegion] = useState('us-east');
  const [visibility, setVisibility] = useState('invite');

  // Step 2 — team
  const [invites, setInvites] = useState('');

  // Step 3 — document
  const [document, setDocument] = useState<File | null>(null);
  const [documentError, setDocumentError] = useState('');

  // Step 4 — review
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const emails = useMemo(() => [...new Set(parseEmails(invites).map(email => email.toLowerCase()))], [invites]);
  const invalidEmails = useMemo(
    () => emails.filter(email => !emailAddress.safeParse(email).success),
    [emails],
  );
  // One rule set, read by the Next button, the Stepper tint, and the review
  // step's issue list. Keyed by step index so a step's validity is a lookup.
  const errorsByStep = useMemo<Array<Record<string, string>>>(() => {
    const details: Record<string, string> = {};
    if (!titleInput.safeParse(name).success) {
      details.name = 'Enter a workspace name of 1–160 characters.';
    }
    if (!workspaceProject.safeParse(project).success) {
      details.project = 'Use up to 160 characters for the project name.';
    }
    if (description.trim().length > 500) details.description = 'Use up to 500 characters for the description.';
    if (editing) return [details, {}, {}, {}];
    if (!slug.trim()) {
      details.slug = 'Enter a URL for the workspace.';
    } else if (TAKEN_SLUGS.includes(slug.trim()) || slug.trim() === takenSlug) {
      details.slug = 'That workspace URL is already taken.';
    } else if (!workspaceSlug.safeParse(slug.trim()).success) {
      details.slug = 'Use up to 63 lowercase letters, numbers, and hyphens, starting and ending with a letter or number.';
    }

    const team: Record<string, string> = {};
    if (!emails.length) team.invites = 'Invite at least one party.';
    else if (invalidEmails.length) team.invites = `Not a valid email address: ${invalidEmails.join(', ')}`;
    else if (emails.length > 39) team.invites = 'Invite up to 39 parties.';

    const documentStep: Record<string, string> = {};
    if (documentError) documentStep.document = documentError;

    const review: Record<string, string> = {};
    if (!acceptedTerms) {
      review.terms = 'Acknowledge the preview to create the workspace.';
    }

    return [details, team, documentStep, review];
  }, [
    name,
    project,
    description,
    editing,
    slug,
    invalidEmails,
    emails.length,
    documentError,
    acceptedTerms,
    takenSlug,
  ]);

  /** Errors to render for a step: only once the user has tried to leave it. */
  const shownErrors = (index: number) =>
    attempted.has(index) ? errorsByStep[index] : {};

  const currentErrors = shownErrors(step);
  const isLastStep = step === STEPS.length - 1;

  // Steps before the current one that the user has already tried and left
  // broken — surfaced on the review step so nothing hides behind a panel.
  const outstanding = STEPS.map((s, i) => ({
    label: s,
    index: i,
    issues: Object.values(shownErrors(i)),
  })).filter(s => s.index !== step && s.issues.length > 0);

  const markAttempted = (index: number) =>
    setAttempted(prev => new Set(prev).add(index));

  const goNext = async () => {
    if (busy) return;
    setSubmitError('');
    markAttempted(step);

    // `validate` records each step's problems in the order the fields appear,
    // so the first key is the first thing on the page that needs attention.
    // Sending focus there is the whole response to a blocked Next: it scrolls
    // the field into view, and the error the field is already showing becomes
    // its accessible description, so a screen reader hears exactly which field
    // and why rather than a count of how many.
    const [firstProblem] = Object.keys(errorsByStep[step]);
    if (firstProblem) {
      fieldRefs[firstProblem as keyof typeof fieldRefs]?.current?.focus();
      return;
    }

    if (!isLastStep) {
      setStep(s => s + 1);
      return;
    }
    const incomplete = errorsByStep.findIndex(errors => Object.keys(errors).length > 0);
    if (incomplete !== -1) {
      markAttempted(incomplete);
      setStep(incomplete);
      return;
    }

    setBusy(true);
    try {
      if (workspace) {
        const changes = {
          ...(name.trim() !== workspace.name ? { name: name.trim() } : {}),
          ...(project.trim() !== (workspace.project ?? '') ? { project: project.trim() } : {}),
          ...(description.trim() !== workspace.description ? { description: description.trim() } : {}),
          ...(status && status !== workspace.status ? { status } : {}),
        };
        if (Object.keys(changes).length) await workspaceAction<Workspace>(workspace.id, 'customize', changes);
        location.assign('/');
        return;
      }
      let attachment;
      if (document) {
        try {
          const {prepareWorkspaceDocument} = await import('../../workspace-document.ts');
          attachment = await prepareWorkspaceDocument(document);
        } catch (error) {
          setDocumentError(errorMessage(error));
          markAttempted(2);
          setStep(2);
          setBusy(false);
          return;
        }
      }
      const created = await workspaceApi<Workspace>({
        requestId, name: name.trim(), project: project.trim(), description: description.trim(),
        slug: slug.trim(), document: attachment, team: emails,
      });
      location.assign(created.firstContractId ? '/contracts/' + created.firstContractId : '/?workspace=' + created.id);
    } catch (error) {
      if (!editing && error instanceof ApiError && error.status === 409 && error.message.includes('workspace URL')) {
        setTakenSlug(slug.trim());
        markAttempted(0);
        setStep(0);
      } else {
        setSubmitError(errorMessage(error));
      }
      setBusy(false);
    }
  };

  const goTo = (index: number) => {
    if (busy) return;
    // Leaving a step forward is an assertion that it is done; leaving it
    // backward is not, so only mark it when moving on.
    if (index > step) {
      markAttempted(step);
    }
    setStep(index);
  };

  return (
    <Layout
      height="fill"
      contentWidth={720}
      // One inset owner for the whole page. Padding set here reaches the
      // header, the body and the footer, so the title, the stepper, every
      // field label and the Back button all start on the same vertical line —
      // and changing the page's breathing room is one number, not three.
      padding={5}
      // Same idea for the fences: the footer's divider comes from one
      // declaration rather than the slot opting in. The header is the one
      // exception, so it is the one place that says so.
      defaultHasDividers
      header={
        // The stepper lives in the header, not the body. It is the one thing
        // on the page that must never scroll away: it answers "where am I and
        // how much is left" at the exact moment a long step makes you ask.
        // The header slot also inherits the Layout's contentWidth, so the
        // stepper and the fields below it share one content line.
        <LayoutHeader hasDivider={false}>
          <VStack gap={isNarrow ? 3 : 5}>
            <HStack gap={3} vAlign="center">
              <StackItem size="fill">
                <Heading level={1}>{wizardTitle}</Heading>
              </StackItem>
              <Button label="Cancel" variant="ghost" href="/" isDisabled={busy} />
            </HStack>
            {/* Indicators sit on the track, and the steps carry a label
                only. A pinned header pays for every line it keeps, and a
                description under each step buys nothing the panel below does
                not already say in full. One stepper at every width: it
                collapses itself once the header is too narrow to label four
                steps, keeping the nodes on the rail tappable. */}
            <Stepper
              activeStep={step}
              orientation="horizontal"
              onStepClick={goTo}
              label={wizardTitle + ' progress'}
              density="balanced"
              indicatorPosition="on-track">
              {STEPS.map((s, i) => (
                <Step
                  key={s}
                  step={i}
                  label={s}
                  isOptional={!editing && s === 'Document'}
                  status={
                    Object.keys(shownErrors(i)).length > 0 ? 'error' : undefined
                  }
                />
              ))}
            </Stepper>
          </VStack>
        </LayoutHeader>
      }
      content={
        // No Card around the step. The pinned header and footer already fence
        // this region, so a card here would be a border inside a border — and
        // its own padding would push every field off the content line the
        // title and stepper sit on.
        <LayoutContent>
          {step === 0 && (
            <VStack gap={5}>
              <VStack gap={1}>
                <Heading level={2}>Workspace details</Heading>
                <Text type="supporting" color="secondary">
                  {editing ? 'Update the workspace name, project, description, or status.'
                    : 'Name your workspace and choose its URL. Region and access choices preview the template. This deployment stores data locally. Your workspace starts private until you invite parties.'}
                </Text>
              </VStack>
              {/* FormLayout, not a VStack: form fields are the one case where
                  the container owns spacing outright, and it also carries
                  `defaultOptionality` so the whole wizard marks optionality
                  one way. Everything here is optional unless it says
                  otherwise, so only the two required fields get an
                  indicator — no field wears both kinds of badge. */}
              <FormLayout defaultOptionality="optional">
                <TextInput
                  label="Workspace name"
                  ref={fieldRefs.name}
                  isRequired
                  value={name}
                  onChange={setName}
                  placeholder="Acme Inc."
                  status={
                    currentErrors.name
                      ? {type: 'error', message: currentErrors.name}
                      : undefined
                  }
                />
                <TextInput label="Project" ref={fieldRefs.project} value={project} onChange={setProject}
                  status={currentErrors.project ? {type: 'error', message: currentErrors.project} : undefined} />
                <TextArea label="Description" ref={fieldRefs.description} value={description}
                  onChange={setDescription} rows={3}
                  status={currentErrors.description ? {type: 'error', message: currentErrors.description} : undefined} />
                <Selector label="Status" value={status ?? 'Automatic'}
                  options={workspace?.status ? [...workspaceStatuses] : ['Automatic', ...workspaceStatuses]}
                  isDisabled={!editing}
                  onChange={value => setStatus(workspaceStatuses.find(option => option === value))} />
                <TextInput
                  label="Workspace URL"
                  ref={fieldRefs.slug}
                  isRequired
                  isReadOnly={editing}
                  value={editing ? location.origin + workspaceURL : slug}
                  onChange={setSlug}
                  placeholder="acme"
                  description={editing ? 'The workspace URL is fixed after creation.'
                    : location.origin + '/?workspaceSlug=' + (slug.trim() || 'your-workspace')}
                  status={currentErrors.slug ? {type: 'error', message: currentErrors.slug} : undefined}
                />
                <Selector
                  label="Data region"
                  options={editing ? [{value: 'deployment', label: 'Managed by the deployment'}, ...REGIONS] : REGIONS}
                  value={editing ? 'deployment' : region}
                  isDisabled={editing}
                  onChange={setRegion}
                  description="Where projects, files, and audit logs are stored at rest."
                />
                <RadioList label="Who can join" value={visibility} onChange={setVisibility} isDisabled={editing}>
                  <RadioListItem
                    value="invite"
                    label="Invite only"
                    description="People join only when an admin invites them."
                  />
                  <RadioListItem
                    value="domain"
                    label="Same domain"
                    description="Anyone with a verified @northwind.dev address can join without an invite."
                  />
                  <RadioListItem
                    value="open"
                    label="Anyone"
                    description="Anyone with the workspace link can request to join."
                  />
                </RadioList>
              </FormLayout>
            </VStack>
          )}

          {step === 1 && (
            <VStack gap={5}>
              <VStack gap={1}>
                <Heading level={2}>Invite your team</Heading>
                <Text type="supporting" color="secondary">
                  {editing ? 'Manage parties and invitations from the workspace.'
                    : 'Invite at least one party to the workspace.'}
                </Text>
              </VStack>
              <FormLayout defaultOptionality="optional">
                <TextArea
                  label="Email addresses"
                  ref={fieldRefs.invites}
                  rows={4}
                  isRequired={!editing}
                  isReadOnly={editing}
                  value={invites}
                  onChange={setInvites}
                  placeholder={'jordan@acme.com\npriya@acme.com'}
                  description="One address per line, or separate them with commas."
                  status={
                    currentErrors.invites
                      ? {type: 'error', message: currentErrors.invites}
                      : emails.length > 0
                        ? {
                            type: 'success',
                            message: `${emails.length} ${
                              emails.length === 1 ? 'address' : 'addresses'
                            } ready to invite.`,
                          }
                        : undefined
                  }
                />
              </FormLayout>
              {editing && <HStack><Button label="Open workspace" href={workspaceURL} /></HStack>}
            </VStack>
          )}

          {step === 2 && (
            <VStack gap={5}>
              <VStack gap={1}>
                <Heading level={2}>Document</Heading>
                <Text type="supporting" color="secondary">
                  {editing ? workspace.documentName ?? 'No document was attached during setup.'
                    : 'Upload an editable PDF to create the first contract, or continue with an empty workspace.'}
                </Text>
              </VStack>
              <FormLayout defaultOptionality="optional">
                <FileInput label="PDF document" ref={fieldRefs.document} mode="dropzone"
                  accept=".pdf,application/pdf" isOptional={!editing} maxSize={workspaceDocumentLimit} value={document} isDisabled={editing || busy}
                  description={editing ? 'The original setup document is fixed after creation.' : 'PDF with selectable text, up to 1 MB.'}
                  onChange={file => {
                    setDocument(Array.isArray(file) ? file[0] ?? null : file);
                    setDocumentError('');
                  }}
                  status={currentErrors.document ? {type: 'error', message: currentErrors.document} : undefined} />
              </FormLayout>
            </VStack>
          )}

          {step === 3 && (
            <VStack gap={5}>
              <VStack gap={1}>
                <Heading level={2}>{editing ? 'Review changes' : 'Review and create'}</Heading>
                <Text type="supporting" color="secondary">
                  {editing ? 'Review the workspace details before saving.'
                    : 'Creating opens this workspace in Canvas and sends the invitations.'}
                </Text>
              </VStack>

              {submitError && <Banner status="error" title={submitError} role="alert" />}
              {outstanding.length > 0 && (
                <Banner
                  status="error"
                  title={`${outstanding.length} ${
                    outstanding.length === 1 ? 'step needs' : 'steps need'
                  } attention`}
                  // Banner collapses children by default. An error summary
                  // is the one case where that is wrong: what is broken has
                  // to be readable without a second click.
                  collapsible={false}>
                  <VStack gap={2}>
                    {outstanding.map(s => (
                      <VStack key={s.label} gap={1}>
                        <Text type="supporting">
                          <Text type="inherit" weight="bold">
                            {s.label}
                          </Text>
                          : {s.issues.join(' ')}
                        </Text>
                      </VStack>
                    ))}
                    <HStack gap={2}>
                      <Button
                        label={`Go to ${outstanding[0].label}`}
                        variant="secondary"
                        size="sm"
                        onClick={() => setStep(outstanding[0].index)}
                      />
                    </HStack>
                  </VStack>
                </Banner>
              )}

              {/* One column, label beside value. A review step is read top to
                  bottom against the steps that produced it, and a two-column
                  grid breaks that into a reading order nobody follows — it
                  also strands the long values (a URL, a sentence about who can
                  join) in half the width they need. */}
              <MetadataList orientation="vertical">
                <MetadataListItem label="Workspace name">
                  {name.trim() || '—'}
                </MetadataListItem>
                <MetadataListItem label="Project">{project.trim() || '—'}</MetadataListItem>
                <MetadataListItem label="Workspace URL">
                  {editing ? location.origin + workspaceURL : location.origin + '/?workspaceSlug=' + (slug.trim() || '—')}
                </MetadataListItem>
                <MetadataListItem label="Description">{description.trim() || '—'}</MetadataListItem>
                <MetadataListItem label="Status">{status ?? 'Automatic'}</MetadataListItem>
                <MetadataListItem label="Data region">
                  {editing ? 'Managed by the deployment' : REGIONS.find(r => r.value === region)?.label ?? region}
                </MetadataListItem>
                <MetadataListItem label="Who can join">
                  {visibility === 'invite'
                    ? 'Invite only'
                    : visibility === 'domain'
                      ? 'Anyone at northwind.dev'
                      : 'Anyone with the link'}
                </MetadataListItem>
                <MetadataListItem label="Invitations">
                  {editing ? 'Managed in the workspace' : emails.join(', ') || '—'}
                </MetadataListItem>
                <MetadataListItem label="Document">
                  {workspace?.documentName ?? document?.name ?? 'None'}
                </MetadataListItem>
              </MetadataList>

              <Divider />

              <CheckboxInput
                label="I understand that the region and join policy choices are previews"
                ref={fieldRefs.terms}
                value={acceptedTerms}
                isDisabled={editing}
                onChange={setAcceptedTerms}
                status={currentErrors.terms ? {type: 'error', message: currentErrors.terms} : undefined}
              />
            </VStack>
          )}
        </LayoutContent>
      }
      footer={
        <LayoutFooter>
          <HStack gap={3} vAlign="center">
            <StackItem size="fill" style={footerZone} />
            {/* Just the position, at every moment. A blocked step used to put
                a summary here, which was a second copy of a message the field
                was already showing and told you a count rather than which
                field. Now Next moves focus to the offending field instead, so
                the answer arrives where the fix has to happen. */}
            <Text type="supporting" color="secondary">
              {step + 1} of {STEPS.length}
            </Text>
            <StackItem size="fill" style={footerZone}>
              <HStack gap={3} hAlign="end">
                <Button
                  label="Back"
                  variant="secondary"
                  isDisabled={step === 0 || busy}
                  onClick={() => setStep(s => Math.max(0, s - 1))}
                />
                <Button
                  label={isLastStep ? (editing ? 'Save changes' : wizardTitle) : 'Next'}
                  variant="primary"
                  // Never disabled: pressing it is how a step reveals what is
                  // wrong. A dead button with no explanation is a dead end.
                  isLoading={busy}
                  onClick={() => { void goNext(); }}
                />
              </HStack>
            </StackItem>
          </HStack>
        </LayoutFooter>
      }
    />
  );
}
