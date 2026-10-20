var portal=require('./portal-api'), page=require('./portal-page')
module.exports=function(favorites){return page({
  cases:function(){wx.navigateTo({url:'/pages/cases/cases'})},
  data:{favorites:!!favorites,loading:true,error:'',items:[],query:'',category:'',hasMore:false,categories:[{id:'',name:'全部文章'},{id:'computer',name:'电脑使用'},{id:'apps',name:'常用应用'}]},
  clearPrivate:function(){this.setData({items:[],hasMore:false})},
  load:function(){return this.loadPage(false)},
  loadPage:function(append){
    var self=this,current=this.guard(),next=append?(this._page||1)+1:1
    this.setData({loading:true,error:''})
    return portal.call('/api/guides?page='+next+'&category='+encodeURIComponent(this.data.category)+'&q='+encodeURIComponent(this.data.query.trim())+(favorites?'&favorites=1':'')).then(function(r){if(!current())return;return portal.articles(r.list).then(function(items){if(current()){self._page=next;self.setData({items:(append?self.data.items:[]).concat(items),hasMore:r.hasMore})}})}).catch(function(e){if(current())self.setData({error:e.message,hasMore:false})}).then(function(){if(current())self.setData({loading:false})})
  },
  input:function(e){this.setData({query:e.detail.value})},
  search:function(){this.setData({items:[]});this.load()},
  select:function(e){this.setData({category:e.currentTarget.dataset.id,items:[]});this.load()},
  more:function(){if(!this.data.loading&&this.data.hasMore)return this.loadPage(true)},
  coverError:function(e){portal.coverError(this,e)},
  retryCover:function(e){return portal.retryCover(this,e)},
  open:function(e){wx.navigateTo({url:'/pages/guide-detail/guide-detail?id='+encodeURIComponent(e.currentTarget.dataset.id)})},
  onReachBottom:function(){return this.more()},
  onShareAppMessage:function(){return {title:'电脑使用指南 · 电脑e家',path:'/pages/guides/guides'}}
})}
