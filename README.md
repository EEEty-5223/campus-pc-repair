# 校园电脑维修预约小程序

面向校园电脑维修社团的微信小程序，支持用户在线预约维修、社团成员分配任务、聊天沟通（含图片）、邀请码入社审核等完整流程。

## 功能概览

### 用户端
- 提交维修预约（姓名、联系方式、设备型号、故障描述、地点、时段）
- 查看自己的预约列表与处理状态
- 在沟通页与社团成员发送文字 / 图片消息
- 待确认状态下可修改或取消预约
- 查看预约处理时间线
- 通过邀请码申请加入社团

### 社团端（按角色分权限）
- **admin**：最高权限，审核入社申请、生成邀请码、分配预约、管理全部成员
- **leader**：部门负责人，生成邀请码（5 小时冷却）、分配本部门预约、管理本部门 member
- **member**：普通成员，仅处理分配给自己的预约

### 权限规则
- admin / leader 之间不能相互分配任务
- admin 之间不能相互修改身份
- admin 不能修改自己的身份
- 成员管理中不能修改已是 admin 的成员

## 技术栈

- 前端：微信小程序原生开发
- 后端：Node.js + Express + MySQL 8.4 + PM2
- 图片存储：服务器本地 `uploads/` + Nginx 静态映射
- 鉴权：基于 openid + admins 表 role 字段

## 目录结构

```text
├── app.js / app.json / app.wxss
├── project.config.json
├── sitemap.json
├── pages/
│   ├── index/       首页
│   ├── booking/     预约表单
│   ├── records/     我的预约
│   ├── detail/      预约详情
│   ├── chat/        沟通页（文字 + 图片）
│   ├── consult/     咨询
│   ├── apply/       入社申请
│   ├── admin/       社团后台
│   └── privacy/     信息使用说明
├── utils/
│   ├── api-request.js   后端接口封装
│   └── appointments.js   预约数据访问
└── images/               tab 图标等静态资源
```

## 后端服务

- 服务器：`47.101.65.57`
- 域名：`https://campusapi.keon5223.xyz`
- 端口：3000（PM2 进程名 `app`）
- 数据库：`campus_repair`

## 部署与运行

### 前端
1. 打开[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 导入本目录，AppID 填写实际小程序 AppID
3. 配置 `app.js` 中的后端域名
4. 编译预览

### 后端
1. 上传 `app.js / db.js / package.json` 到服务器 `/www/wwwroot/campus-repair-server/`
2. 安装依赖：`npm install`
3. 重启服务：`pm2 restart app --update-env`

## 微信公众平台配置

上线前必须在微信公众平台完成：

1. **服务器域名**
   - `request` 合法域名：`https://campusapi.keon5223.xyz`
   - `uploadFile` 合法域名：`https://campusapi.keon5223.xyz`
   - `downloadFile` 合法域名：`https://campusapi.keon5223.xyz`

2. **服务类目**
   - 推荐：`工具 → 实用工具`
   - 主营类目需在服务类目审核通过后设置

3. **隐私保护指引**
   - 设置 → 基本设置 → 小程序隐私保护指引
   - 收集手机号 / openid 必须声明

## 注意事项

- 个人主体小程序不能开通微信支付，本程序采用纯预约 + 沟通模式，不涉及在线收款
- 个人主体可通过「流量主」（UV ≥ 1000）接入广告变现
- 想把普通成员提升为 admin，只能直接改数据库，API 不再支持
- SSL 证书到期会导致接口全部失败，注意续期
- 上线前建议打包备份当前前后端代码