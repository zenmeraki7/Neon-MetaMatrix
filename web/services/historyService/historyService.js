import { NotFoundError } from "../../utils/errorUtils.js";
import { EDIT_TYPES, FIELD_TRANSLATIONS } from "../../Config/constants.js";
import { getCache, setCache } from "../../utils/cacheUtils.js";
import { historyRepository } from "../../repositories/history.repository.js";

const VALID_TYPES = new Set(["Manual edit", "Scheduled edit", "Recurring edit"]);

function getLocalizedJsonText(value, lang = "en") {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    return String(value);
  }

  return value[lang] ?? value.en ?? Object.values(value)[0] ?? null;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function assertValidHistoryId(id) {
  if (!id || id === "undefined" || id === "null") {
    throw new NotFoundError(`Invalid history ID format: ${id}`, "Invalid ID");
  }
}

export class EditHistoryService {
  constructor(session, activePlan) {
    this.session = session;
    this.plan = activePlan?.name || "Basic";
  }

  getDateLimit() {
    const planDurations = {
      "Basic (Monthly)": 60,
      "Basic (Yearly)": 60,
      "Advanced (Monthly)": 90,
      "Advanced (Yearly)": 90,
      "Pro (Monthly)": 180,
      "Pro (Yearly)": 180,
    };

    const days = planDurations[this.plan] || 0;
    const date = new Date();
    date.setDate(date.getDate() - days);

    return { dateLimit: date, planLimit: days };
  }

  async getEditHistories({ type, search, cursor, limit = 10, lang }) {
    try {
      const shop = this.session.shop;
      const language = lang || "en";
      const limitNumber = normalizePositiveInt(limit, 10);

      const baseWhere = {
        shop,
        ...(type === "Favorites"
          ? { isFavourite: true }
          : VALID_TYPES.has(type)
            ? { type }
            : {}),
      };

      let cursorFilter = {};
      if (cursor) {
        const cursorRecord = await historyRepository.findHistoryCursorRecord({
          id: cursor,
          shop,
        });

        if (cursorRecord) {
          cursorFilter = {
            OR: [
              { createdAt: { lt: cursorRecord.createdAt } },
              {
                AND: [
                  { createdAt: cursorRecord.createdAt },
                  { id: { lt: cursorRecord.id } },
                ],
              },
            ],
          };
        }
      }

      const cacheKey = `${shop}:fetchHistories:${limitNumber}:${cursor || "first"}:${type || "all"}:${search || ""}:${language}`;
      const cacheHistories = await getCache(cacheKey);

      if (cacheHistories) {
        return {
          ...cacheHistories,
          ref: "Fetched edit histories successfully from cache.",
        };
      }

      const queryWhere =
        Object.keys(cursorFilter).length > 0
          ? {
              AND: [baseWhere, cursorFilter],
            }
          : baseWhere;

      const records = await historyRepository.findEditHistoriesPage({
        where: queryWhere,
        take: limitNumber + 1,
      });

      const hasNextPage = records.length > limitNumber;
      const edges = hasNextPage ? records.slice(0, -1) : records;

      const formattedData = edges.map((record) => ({
        ...record,
        title: getLocalizedJsonText(record.title, language),
      }));

      const totalCount = await historyRepository.countEditHistories({
        where: baseWhere,
      });

      const returnData = {
        edges: formattedData,
        pageInfo: {
          hasNextPage,
          endCursor: edges.length > 0 ? edges[edges.length - 1].id : null,
        },
        totalCount,
      };

      await setCache(cacheKey, returnData, 300);

      return {
        ...returnData,
        ref: "Fetched edit histories successfully from database.",
      };
    } catch (error) {
      throw new Error(`Error fetching history records: ${error.message}`);
    }
  }

  async getHistoryDetails(id, lang) {
    try {
      assertValidHistoryId(id);

      const shop = this.session.shop;
      const language = lang || "en";
      const cacheKey = `${shop}:historyDetails:${id}-${language}`;
      const cacheData = await getCache(cacheKey);

      if (cacheData) {
        return cacheData;
      }

      const history = await historyRepository.findHistoryDetailsByIdAndShop({
        id,
        shop,
      });

      if (!history) {
        throw new NotFoundError(
          `History record ${id} not found`,
          "History not found",
        );
      }

      const rules = Array.isArray(history.rules) ? history.rules : [];
      const rule = rules[0] ?? { field: "csv" };

      const returnData = {
        ...history,
        title: getLocalizedJsonText(history.title, language),
        field:
          FIELD_TRANSLATIONS?.[rule?.field]?.[language] ??
          rule?.field ??
          "unknown_field",
        type:
          EDIT_TYPES?.[history.type]?.[language] ??
          history.type ??
          "unknown_type",
        progressCount: Number(history.processedCount || 0),
      };

      await setCache(cacheKey, returnData, 300);
      return returnData;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new Error(`Error fetching history details: ${error.message}`);
    }
  }

  async getHistoryEditChanges(id, page = 1, limit = 10) {
    try {
      assertValidHistoryId(id);

      const shop = this.session.shop;
      const pageNum = normalizePositiveInt(page, 1);
      const limitNum = Math.min(100, normalizePositiveInt(limit, 10));
      const skip = (pageNum - 1) * limitNum;

      const cacheKey = `${shop}:historyChanges:${id}:page${pageNum}:limit${limitNum}`;
      const cacheData = await getCache(cacheKey);

      if (cacheData) {
        return {
          changes: cacheData.changes,
          currentPage: cacheData.currentPage,
          totalPages: cacheData.totalPages,
          totalCount: cacheData.totalCount,
          message: "Fetched history changes successfully from cache.",
        };
      }

      const history = await historyRepository.findHistoryExistsByIdAndShop({
        id,
        shop,
      });

      if (!history) {
        throw new NotFoundError(
          `History record ${id} not found`,
          "History not found",
        );
      }

      const totalCount = await historyRepository.countHistoryChanges({
        editHistoryId: id,
        shop,
      });

      const totalPages = Math.ceil(totalCount / limitNum);

      const changes = await historyRepository.findHistoryChangesPage({
        editHistoryId: id,
        shop,
        skip,
        take: limitNum,
      });

      const result = {
        changes,
        currentPage: pageNum,
        totalPages,
        totalCount,
        message: "Fetched history changes successfully.",
      };

      await setCache(cacheKey, result, 300);
      return result;
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }

      throw new Error(`Error fetching history changes: ${error.message}`);
    }
  }
}