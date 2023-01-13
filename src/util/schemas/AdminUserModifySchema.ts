import { PublicUser } from "..";

export interface AdminUserModifySchema extends Partial<PublicUser> {
	rights?: string;
}
