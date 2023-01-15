import { Router, Request, Response } from "express";
import {
	User,
	AdminUserModifySchema,
	PublicUserProjection,
	handleFile,
	Rights,
	FieldError,
	FosscordApiErrors,
	FieldErrors,
	Config,
} from "@fosscord/util";
import { route } from "@fosscord/api";

const router: Router = Router();

router.get(
	"/",
	route({ right: "MANAGE_USERS" }),
	async (req: Request, res: Response) => {
		const { id } = req.params;

		const user = await User.getPublicUser(id, { select: ["rights"] });

		res.json({ ...user.toPublicUser(), rights: user.rights });
	},
);

router.patch(
	"/",
	route({ right: "MANAGE_USERS", body: "AdminUserModifySchema" }),
	async (req: Request, res: Response) => {
		const body = req.body as AdminUserModifySchema;

		const user = await User.findOneOrFail({
			where: { id: req.params.id },
			select: [...PublicUserProjection, "rights"],
		});

		if (body.rights && user.rights != body.rights) {
			// Only allow assigning new rights to users if we are operator.
			req.rights.hasThrow("OPERATOR");

			const forwardedFor = Config.get().security.forwadedFor;
			const requestor =
				req.socket.remoteAddress ||
				(forwardedFor ? req.headers[forwardedFor] : "");

			const right = new Rights(body.rights);
			if (right.has("OPERATOR") && requestor !== "127.0.0.1") {
				throw FieldErrors({
					rights: {
						message:
							"Operator is unsafe. Send request from localhost if certain.",
						code: "DONT_BE_DUMB", // TODO lol
					},
				});
			}
		}

		user.assign(body);

		// Doing this *after* assign so that we can set user.avatar/etc to undef.
		// TODO: If we set the properties to nullable in ts instead of optional,
		// this would be unnecessary
		// lol types
		for (var type of ["avatar", "banner"] as ["avatar", "banner"]) {
			if (type in body) {
				if (body[type] === null) user[type] = undefined;
				if (body[type] !== user[type]) {
					// upload a new avatar or banner

					user[type] = await handleFile(
						`/${type}s/${user.id}`,
						body.avatar as string,
					);
				}
			}
		}

		await user.save();

		return res.json({ ...user.toPublicUser(), rights: user.rights });
	},
);

export default router;
