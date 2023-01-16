import { Router, Request, Response } from "express";
import { Config, ConfigEntity } from "@fosscord/util";
import { route } from "@fosscord/api";

const router: Router = Router();

router.get(
	"/",
	// This should be MANAGE_CONFIG or similar, instead
	route({ right: "OPERATOR" }),
	async (req: Request, res: Response) => {
		const configs = await ConfigEntity.find({});
		return res.json({
			data: configs.map((x) => ({ id: x.key, value: x.value })),
			total: configs.length,
		});
	},
);

export default router;
