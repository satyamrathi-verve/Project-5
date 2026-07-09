/*
  Users & Access Management — public barrel. Import from "@/lib/users" everywhere.
*/
export * from "./types";
export * from "./roles";
export * from "./access";
export { useCurrentAccess, type CurrentAccess } from "./useAccess";
export {
  getAllUsers,
  getUserById,
  getUserByUsername,
  isUsernameTaken,
  isEmailTaken,
  countActiveAdmins,
  authenticate,
  createUser,
  updateUser,
  changeRole,
  resetPassword,
  setStatus,
  deleteUser,
  onUsersChange,
} from "./store";
export {
  logUserAudit,
  getUserAudit,
  getUserAuditFor,
  countUserAudit,
  onUserAuditChange,
  USER_AUDIT_ACTION_LABELS,
} from "./audit";
