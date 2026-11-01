import * as tf from "@tensorflow/tfjs";
import { load } from "nsfwjs/core";
import { MobileNetV2MidModel } from "nsfwjs/models/mobilenet_v2_mid";
// Проверка изображения на 18+ прямо на устройстве; модель MobileNetV2 (mid) вшита в этот файл, фото никуда не отправляется.
let model = null;
window.__sparkNsfw = async (img) => {
  model = model || (await load("MobileNetV2Mid", { size: 224, modelDefinitions: [MobileNetV2MidModel] }));
  const r = await model.classify(img, 5);
  const p = Object.fromEntries(r.map((x) => [x.className, x.probability]));
  const porn = p.Porn ?? 0, hentai = p.Hentai ?? 0, sexy = p.Sexy ?? 0;
  return { ok: !(porn > 0.15 || hentai > 0.25 || sexy > 0.6 || porn + hentai + sexy > 0.7), scores: p };
};
