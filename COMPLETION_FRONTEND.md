# 完工照片与特殊单：前端接口约定

2026-10-18更新：下列接口已由配套本地后端`completion-service.js`实现并完成本地接口验收，尚未部署线上。2026-10-17的“仅前端”说明为GitHub v1.2.3快照的历史状态。新规则与验收说明见`FEATURES_20261018.md`，不能把本地完成视为线上已经更新。

## 页面与流程

- 后台“完成维修”打开 `pages/completion/completion?id=预约ID`。
- 正常至少1张照片，前端默认最多9张、单张不超过10MB，服务端返回的上限可收紧；相册和拍照均可。照片上传成功后才进入4位完成码步骤。
- 被分配人员可选择“用户不方便拍照”，确认后直接进入完成码步骤；不必等待审核再完工。完成码验证成功的事务中完成预约并生成特殊单待审核记录。
- 后台首页“特殊单”入口限leader/admin显示。待审核数来自汇总接口，大于0时显示红点和“（待审核单：数量）”。接口失败显示数量暂不可用，不当作0。
- 提醒卡片收成可展开的小入口；原微信订阅、刷新和暂停方法保持绑定，展开后操作。
- 特殊单页面展示待审核/已通过/未通过；服务端 `canReview` 为true才显示审核按钮。拒绝须填1至200字原因。只有服务端确认保存后才刷新状态。
- 用户已确认：只有免拍照订单需要事后审核，普通照片单不进入特殊单列表；新预约提醒收成可展开的小入口。审核不通过后的处理仍待确认。

## 身份与路由

全部接口要求现有 `Authorization: Bearer notificationSession`。服务端从会话识别人员，不接受前端决定审核部门或身份。

### GET `/api/appointments/:id/completion`

返回 `{ok:true, available:true, canSubmit:true, canSkipPhoto:true, maxPhotos:9}`。校验预约未作废且维修中、当前可操作人员；免拍照权限必须根据实际分配判断。此接口只读，不生成完成记录。

### POST `/api/appointments/:id/completion/photos`

multipart字段 `file`，返回 `{ok:true,photo:{id:"照片ID",url:"查看地址"}}`。服务端校验真实文件类型、大小、身份和预约权限，将照片绑定预约和上传者。上传失败/未提交照片须制定清理规则。照片读取也必须由服务端限制权限，前端隐藏图片不构成保护。

### POST `/api/appointments/:id/completion`

请求：

```json
{"completionCode":"0123","evidenceType":"no_photo","photoIds":[],"noPhotoReason":"用户不方便拍照","note":"选填说明","requestKey":"同一次提交重试保持一致"}
```

有照片时 `evidenceType:"photos"`，`photoIds` 至少一个、`noPhotoReason` 为空。

返回 `{ok:true,status:"completed",reviewStatus:"pending"}`；正常照片单默认 `reviewStatus:"not_required"`。服务端必须同一事务验证完成码、所属照片、当前分配和状态、记录完工和审计；免拍照单同时创建唯一待审记录。错码/锁定等沿用现有规则，失败不能留下“已完成”或已审核的半状态。

`requestKey` 用于幂等，服务端绑定提交人、预约和请求内容。超时重试不得重复消耗完成码或重复创建待审单。旧 `/api/appointments/status` 的 completed 通道须在后端接入时同步收紧，不能绕过照片/免拍照规则；管理员强制完成须另行确定例外规则。

### GET `/api/appointments/special-orders/summary`

返回 `{ok:true,pendingCount:2}`，整数且非负。仅admin或提交人员所属部门的leader可见；计数必须与审核列表使用相同权限范围。固定 `special-orders` 路由应注册在动态 `:id` 之前。

### GET `/api/appointments/special-orders?status=pending&page=1`

`status` 允许pending/approved/rejected。返回：

```json
{"ok":true,"pendingCount":1,"hasMore":false,"list":[{"id":"review-id","appointmentId":"appointment-id","customerName":"预约用户","deviceType":"笔记本电脑","submitterName":"维修人员","submitterDepartment":"技术部","submittedAt":"2026-10-17 14:00","status":"pending","reason":"用户不方便拍照","note":"","photos":[],"canReview":true}]}
```

审核后可附 `reviewerName`、`reviewedAt`、`reviewReason`。应固定提交时所属部门作为归属并明确后续调部门、停用、管理员提交等场景的审核规则。`canReview` 以服务端最新身份与业务规则决定。

### POST `/api/appointments/special-orders/:id/review`

`{decision:"approve"|"reject",reason:"不通过必填",requestKey:"幂等键"}`。返回 `{ok:true,reviewStatus:"approved"|"rejected"}`。

admin或本部门leader其中一人可处理，服务端事务防止两人同时审核、重复覆盖；审核人、时间、结果、原因入审计。审核不通过后是否需补充说明、是否重新提交，尚待用户确认；前端目前只展示结果，不自行回退维修状态。

### 预约列表扩展

可附 `completionReview:{id,status,evidenceType}`。admin/leader看到pending时显示“本单为特殊单，待审核”，点击进入列表。没有该字段时不显示虚构状态。

## 未完成事项

后端接口、数据库迁移、权限和照片安全、上传清理、旧接口防绕过、审核不通过后的处理及重新提交、历史单兼容、真机完整验收、部署均未在本轮实现。
