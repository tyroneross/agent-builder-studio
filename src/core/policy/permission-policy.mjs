export const PERMISSIONS = {
  READ_LOCAL: "read-local",
  DRAFT: "draft",
  ASK_FIRST: "ask-first",
  WRITE_APPROVED: "write-approved",
  SYSTEM_APPROVED: "system-approved",
  INTERNET_APPROVED: "internet-approved",
  DELETE_APPROVED: "delete-approved",
};

const DEFAULT_RULES = {
  [PERMISSIONS.READ_LOCAL]: "allow",
  [PERMISSIONS.DRAFT]: "allow",
  [PERMISSIONS.ASK_FIRST]: "queue",
  [PERMISSIONS.WRITE_APPROVED]: "queue",
  [PERMISSIONS.SYSTEM_APPROVED]: "block",
  [PERMISSIONS.INTERNET_APPROVED]: "block",
  [PERMISSIONS.DELETE_APPROVED]: "block",
};

export function policyFor(permission) {
  return DEFAULT_RULES[permission] || "block";
}

export function requiresApproval(permission) {
  return policyFor(permission) === "queue";
}

export function isBlocked(permission) {
  return policyFor(permission) === "block";
}

export function describePermission(permission) {
  const policy = policyFor(permission);
  return {
    permission,
    policy,
    canRunAutomatically: policy === "allow",
    requiresApproval: policy === "queue",
    blockedByDefault: policy === "block",
  };
}
