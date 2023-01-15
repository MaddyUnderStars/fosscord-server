import { Router, Request, Response } from "express";
import { Guild } from "@fosscord/util";
import { route } from "@fosscord/api";

const router: Router = Router();

router.get(
	"/",
	route({ right: "MANAGE_GUILDS" }),
	async (req: Request, res: Response) => {
		const { id } = req.params;
		const guild = await Guild.findOneOrFail({ where: { id } });
		res.json(guild);
	},
);

export default router;
