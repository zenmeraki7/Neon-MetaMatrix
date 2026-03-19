import { addbulkEditJob } from "../../Jobs/Queues/bulkEditJob.js";
import { clearKeyCaches } from "../../utils/cacheUtils.js";
import { productBulkRepository } from "../../repositories/productBulk.repository.js";
import { ProductBulkPlannerService } from "./productBulkPlanner.service.js";
import { ProductBulkMutationService } from "./productBulkMutation.service.js";
import { ProductBulkPreviewService } from "./productBulkPreview.service.js";

export default class ProductBulkService {
  constructor(session) {
    this.session = session;
    this.plannerService = new ProductBulkPlannerService(session, productBulkRepository);
    this.mutationService = new ProductBulkMutationService(session);
    this.previewService = new ProductBulkPreviewService(session, productBulkRepository);
  }

  async bulkEditProducts(req) {
    const payload = await this.plannerService.buildBulkEditHistoryPayload(
      req?.body || {},
      req?.subscription || {},
    );

    const history = await productBulkRepository.createEditHistory(payload);

    await clearKeyCaches(`${history.shop}:fetchHistories`);

    await addbulkEditJob({
      historyId: history.id,
      session: this.session,
    });

    return history;
  }

  async _bulkOperationHelper({ formattedProducts, field }) {
    return this.mutationService.runBulkOperation({
      formattedProducts,
      field,
    });
  }

  async _preparingBulkOperation({ historyId }) {
    return this.plannerService.prepareBulkOperationBatch({ historyId });
  }

  async trackEditProducts(args) {
    return this.previewService.trackEditProducts(args);
  }
}