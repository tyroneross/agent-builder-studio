import { PERMISSIONS } from "../core/policy/permission-policy.mjs";

export const TOOL_REGISTRY = [
  {
    id: "workspace.status",
    label: "Workspace Status",
    permission: PERMISSIONS.READ_LOCAL,
    maturity: "implemented",
    description: "Inspect configured CoS workspace files and readiness.",
  },
  {
    id: "documents.create",
    label: "Create Document",
    permission: PERMISSIONS.DRAFT,
    maturity: "implemented",
    description: "Create a new document inside the CoS documents folder without overwriting existing files.",
  },
  {
    id: "approvals.enqueue",
    label: "Enqueue Approval",
    permission: PERMISSIONS.ASK_FIRST,
    maturity: "implemented",
    description: "Record a pending user decision before any sensitive write/system/internet action.",
  },
  {
    id: "calendar.ics.import",
    label: "Import ICS",
    permission: PERMISSIONS.READ_LOCAL,
    maturity: "implemented",
    description: "Parse pasted or local .ics calendar text.",
  },
  {
    id: "calendar.ics.export",
    label: "Export ICS",
    permission: PERMISSIONS.DRAFT,
    maturity: "implemented",
    description: "Write an .ics export into the CoS workspace.",
  },
  {
    id: "tasks.crud",
    label: "Tasks CRUD",
    permission: PERMISSIONS.DRAFT,
    maturity: "planned",
    description: "Create, list, update, and complete local CoS tasks with stable IDs.",
  },
  {
    id: "commitments.extract",
    label: "Extract Commitments",
    permission: PERMISSIONS.DRAFT,
    maturity: "planned",
    description: "Extract owner/action/date commitments from notes and meeting transcripts.",
  },
  {
    id: "people.lookup",
    label: "Lookup Person",
    permission: PERMISSIONS.READ_LOCAL,
    maturity: "planned",
    description: "Lookup local people-index context for meeting prep and follow-ups.",
  },
  {
    id: "integrations.apple-calendar",
    label: "Apple Calendar Adapter",
    permission: PERMISSIONS.SYSTEM_APPROVED,
    maturity: "planned",
    description: "Future system-approved adapter for Apple Calendar.",
  },
  {
    id: "integrations.slack",
    label: "Slack Adapter",
    permission: PERMISSIONS.INTERNET_APPROVED,
    maturity: "planned",
    description: "Future internet-approved adapter for Slack follow-up drafts and context.",
  },
];

export function listTools() {
  return TOOL_REGISTRY;
}
