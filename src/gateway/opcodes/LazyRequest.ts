import {
	getDatabase,
	getPermission,
	listenEvent,
	Member,
	Role,
	Session,
	LazyRequestSchema,
} from "@fosscord/util";
import {
	WebSocket,
	Payload,
	handlePresenceUpdate,
	OPCODES,
	Send,
} from "@fosscord/gateway";
import { check } from "./instanceOf";

// TODO: only show roles/members that have access to this channel
// TODO: config: to list all members (even those who are offline) sorted by role, or just those who are online
// TODO: rewrite typeorm

async function getMembers(guild_id: string, range: [number, number]) {
	if (!Array.isArray(range) || range.length !== 2) {
		throw new Error("range is not a valid array");
	}
	// TODO: wait for typeorm to implement ordering for .find queries https://github.com/typeorm/typeorm/issues/2620

	let members = await Member.find({
		where: { guild_id },
		relations: {
			roles: true,
			user: {
				sessions: true,
			}
		},
		order: {
			roles: {
				position: "DESC",
			},
			user: {
				username: "ASC",
			},
		},
		take: range[1] || 100,
		skip: range[0] || 0,
	});

	if (!members) {
		return {
			items: [],
			groups: [],
			range: range,
			members: [],
		};
	}

	let groups = [];
	let items = [];
	const member_roles = members
		.map((m) => m.roles)
		.flat()
		.unique((r: Role) => r.id);
	member_roles.push(
		member_roles.splice(
			member_roles.findIndex((x) => x.id === x.guild_id),
			1,
		)[0],
	);

	const offlineItems = [];

	for (const role of member_roles) {
		const [role_members, other_members]: Member[][] = partition(
			members,
			(m) => !!m.roles.find((r) => r.id === role.id),
		);
		const group = {
			count: role_members.length,
			id: role.id === guild_id ? "online" : role.id,
		};

		items.push({ group });
		groups.push(group);

		for (const member of role_members) {
			const roles = member.roles
				.filter((x: Role) => x.id !== guild_id)
				.map((x: Role) => x.id);

			const statusMap = {
				online: 0,
				idle: 1,
				dnd: 2,
				invisible: 3,
				offline: 4,
			};
			// sort sessions by relevance
			const sessions = member.user.sessions.sort((a, b) => {
				return (
					statusMap[a.status] -
					statusMap[b.status] +
					(a.activities.length - b.activities.length) * 2
				);
			});
			var session: Session | undefined = sessions.first();

			if (session?.status == "offline") {
				session.status = member.user.settings.status || "online";
			}

			const item = {
				member: {
					...member,
					roles,
					user: member.user.toPublicUser(),
					presence: {
						...session,
						activities: session?.activities || [],
						user: { id: member.user.id },
					},
				},
			};

			if (
				!session ||
				session.status == "invisible" ||
				session.status == "offline"
			) {
				item.member.presence.status = "offline";
				offlineItems.push(item);
				group.count--;
				continue;
			}

			items.push(item);
		}
		members = other_members;
	}

	if (offlineItems.length) {
		const group = {
			count: offlineItems.length,
			id: "offline",
		};
		items.push({ group });
		groups.push(group);

		items.push(...offlineItems);
	}

	groups = groups.filter(x => x.count > 0);
	items = items.filter((x: any) => x.group ? x.group.count > 0 : true);

	return {
		items,
		groups,
		range,
		members: items
			.map((x) => ("member" in x ? { ...x.member, settings: undefined } : undefined))
			.filter((x) => !!x),
	};
}

export async function onLazyRequest(this: WebSocket, { d }: Payload) {
	// TODO: check data
	check.call(this, LazyRequestSchema, d);
	const { guild_id, typing, channels, activities } = d as LazyRequestSchema;

	const channel_id = Object.keys(channels || {}).first();
	if (!channel_id) return;

	const permissions = await getPermission(this.user_id, guild_id, channel_id);
	permissions.hasThrow("VIEW_CHANNEL");

	const ranges = channels![channel_id];
	if (!Array.isArray(ranges)) throw new Error("Not a valid Array");

	const member_count = await Member.count({ where: { guild_id } }) - 1;
	const ops = await Promise.all(ranges.map((x) => getMembers(guild_id, x)));

	// TODO: unsubscribe member_events that are not in op.members

	ops.forEach((op) => {
		op.members.forEach(async (member) => {
			if (!member) return;
			if (this.events[member.user.id]) return; // already subscribed as friend
			if (this.member_events[member.user.id]) return; // already subscribed in member list
			this.member_events[member.user.id] = await listenEvent(
				member.user.id,
				handlePresenceUpdate.bind(this),
				this.listen_options,
			);
		});
	});

	const groupsWithDupes = ops.map(x => x.groups).flat();
	const groups: { count: number, id: string; }[] = [];
	for (var group of groupsWithDupes) {
		const index = groups.findIndex((x) => x.id == group.id);
		if (index !== -1) {
			groups[index].count += group.count;
			continue;
		}

		groups.push(group);
	}

	for (var opInx = 0; opInx < ops.length; opInx++) {
		for (var itemInx = 0; itemInx < ops[opInx].items.length; itemInx++) {
			if ("member" in ops[opInx].items[itemInx]) continue;

			let foundGroup: number = -1;
			//@ts-ignore
			const foundOp = ops.findIndex(x => foundGroup = x.groups.findIndex(y => y.id == ops[opInx].items[itemInx].group.id));
			if (foundOp === -1 || foundGroup === -1) continue;

			//@ts-ignore
			ops[foundOp].items[foundGroup].count += ops[opInx].items[itemInx].group.count;
			
			ops[opInx].items.splice(itemInx, 1);
			itemInx--;
		}
	}

	return await Send(this, {
		op: OPCODES.Dispatch,
		s: this.sequence++,
		t: "GUILD_MEMBER_LIST_UPDATE",
		d: {
			ops: ops.map((x) => ({
				items: x.items,
				op: "SYNC",
				range: x.range,
			})),
			online_count:
				member_count -
				(groups.find((x) => x.id == "offline")?.count ?? 0),
			member_count,
			id: "everyone",
			guild_id,
			groups,
		},
	});
}

/* https://stackoverflow.com/a/50636286 */
function partition<T>(array: T[], filter: (elem: T) => boolean) {
	let pass: T[] = [], fail: T[] = [];
	array.forEach((e) => (filter(e) ? pass : fail).push(e));
	return [pass, fail];
}