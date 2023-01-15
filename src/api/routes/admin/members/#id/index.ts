import { Router, Request, Response } from "express";
import { Member } from "@fosscord/util";
import { route } from "@fosscord/api";
import { Like } from "typeorm";

const router: Router = Router();

router.get(
	"/",
	route({ right: ["MANAGE_USERS", "MANAGE_GUILDS"] }),
	async (req: Request, res: Response) => {
		const { take, skip, sort, order } = req.query;
		const filter = req.query.filter
			? JSON.parse(req.query.filter as string)
			: undefined;

		const totalCount = await Member.count({ where: filter });
		const users = await Member.find({
			where: { ...filter, id: req.params.id },
			take: take ? parseInt(take as string) : undefined,
			skip: skip ? parseInt(skip as string) : undefined,
			order:
				sort && order
					? {
							[sort as string]: Like(order),
					  }
					: undefined,
		});

		return res.json({
			total: totalCount,
			data: users,
		});
	},
);

export default router;
