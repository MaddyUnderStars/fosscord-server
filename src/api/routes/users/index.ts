import { Router, Request, Response } from "express";
import { PublicUserProjection, User } from "@fosscord/util";
import { route } from "@fosscord/api";
import { Like } from "typeorm";

const router: Router = Router();

/** Admin dashboard */
router.get(
	"/",
	route({ right: "MANAGE_USERS" }),
	async (req: Request, res: Response) => {
		const { take, skip, sort, order } = req.query;
		const filter = req.query.filter
			? JSON.parse(req.query.filter as string)
			: undefined;

		const totalCount = await User.count({ where: filter });
		const users = await User.find({
			where: filter,
			take: take ? parseInt(take as string) : undefined,
			skip: skip ? parseInt(skip as string) : undefined,
			order:
				sort && order
					? {
							[sort as string]: Like(order),
					  }
					: undefined,
			select: [...PublicUserProjection, "rights"],
		});

		return res.json({
			total: totalCount,
			data: users.map((x) => x.toPublicUser()),
		});
	},
);

export default router;
