/**
 * ViewContext types — defines the shape of the view context
 * used to provide role and permission information to UI components.
 */

export interface ViewContextValue {
  role: "owner" | "viewer";
  userId?: string;
  grantId?: string;
  permissions: {
    metrics: string[] | "all";
    dataStart: string | null;
    dataEnd: string | null;
  };
  ownerDisplayName?: string;
  note?: string;
}
