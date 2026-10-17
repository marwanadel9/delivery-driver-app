const products = [
  {id:"chicken-1",name:"فروج كامل طازج",category:"chicken",categoryName:"دجاج كامل",desc:"فروج كامل مناسب للوجبات اليومية.",emoji:"🍗",badge:"الأكثر طلبًا",prices:{individual:22,restaurant:19,trader:17}},
  {id:"chicken-2",name:"فروج كامل كبير",category:"chicken",categoryName:"دجاج كامل",desc:"حجم كبير لتحضير وجبات العائلة.",emoji:"🍗",badge:"حجم كبير",prices:{individual:27,restaurant:24, trader:22}},
  {id:"pieces-1",name:"صدور دجاج",category:"pieces",categoryName:"قطع الدجاج",desc:"صدور دجاج لوجبات متنوعة.",emoji:"🍖",badge:"اختيار مميز",prices:{individual:28,restaurant:25,trader:23}},
  {id:"pieces-2",name:"أفخاذ دجاج",category:"pieces",categoryName:"قطع الدجاج",desc:"قطع مناسبة للشوي والطبخ.",emoji:"🍗",badge:"",prices:{individual:24,restaurant:21,trader:19}},
  {id:"pieces-3",name:"أجنحة دجاج",category:"pieces",categoryName:"قطع الدجاج",desc:"مناسبة للقلي والشوي والتتبيل.",emoji:"🍗",badge:"",prices:{individual:18,restaurant:16,trader:14}},
  {id:"pieces-4",name:"دجاج مقطع",category:"pieces",categoryName:"قطع الدجاج",desc:"قطع جاهزة للتحضير والطبخ.",emoji:"🥘",badge:"",prices:{individual:25,restaurant:22,trader:20}},
  {id:"other-1",name:"كبدة وقوانص",category:"other",categoryName:"منتجات أخرى",desc:"منتجات مختارة لوجباتك اليومية.",emoji:"🥩",badge:"",prices:{individual:15,restaurant:13,trader:11}},
  {id:"other-2",name:"منتجات فروج الزين",category:"other",categoryName:"منتجات أخرى",desc:"أضف منتجاتك الفعلية عند تجهيز الكتالوج.",emoji:"🧺",badge:"قريبًا",prices:{individual:12,restaurant:10,trader:9}}
];
const typeLabels = {individual:"فرد",restaurant:"مطعم",trader:"تاجر"};
let customerType = "individual";
let selectedCategory = "all";
let cart = {};
let toastTimer;
const $ = id => document.getElementById(id);
const money = value => `${Number(value || 0).toFixed(2)} د.إ`;
function getProduct(id){return products.find(p=>p.id===id)}
function priceFor(product){return product.prices[customerType]}
function visibleProducts(){
  const q = $("searchInput").value.trim().toLowerCase();
  return products.filter(p=>(selectedCategory==="all"||p.category===selectedCategory)&&(!q||`${p.name} ${p.categoryName} ${p.desc}`.toLowerCase().includes(q)));
}
function renderProducts(){
  const list=visibleProducts();
  $("productGrid").innerHTML=list.map(p=>`
    <article class="product-card">
      <div class="product-visual"><span class="product-emoji">${p.emoji}</span>${p.badge?`<span class="product-badge">${p.badge}</span>`:""}</div>
      <div class="product-body"><span class="product-category">${p.categoryName}</span><h3>${p.name}</h3><p class="product-desc">${p.desc}</p>
        <div class="product-bottom"><div class="product-price">${money(priceFor(p))}<small> / قطعة تجريبية</small></div><button class="add-button" type="button" data-add="${p.id}" aria-label="أضف ${p.name} للسلة">+</button></div>
      </div>
    </article>`).join("");
  $("emptyState").classList.toggle("hidden",list.length!==0);
}
function cartCount(){return Object.values(cart).reduce((n,q)=>n+q,0)}
function subtotal(){return Object.entries(cart).reduce((sum,[id,q])=>sum+priceFor(getProduct(id))*q,0)}
function renderCart(){
  $("cartCount").textContent=cartCount();
  const ids=Object.keys(cart).filter(id=>cart[id]>0);
  $("cartItems").innerHTML=ids.length?ids.map(id=>{
    const p=getProduct(id),q=cart[id];
    return `<div class="cart-row"><div class="cart-thumb">${p.emoji}</div><div><h4>${p.name}</h4><small>${money(priceFor(p))} للقطعة</small><div class="qty-control"><button type="button" data-qty="-1" data-id="${id}" aria-label="تقليل">−</button><span>${q}</span><button type="button" data-qty="1" data-id="${id}" aria-label="زيادة">+</button></div></div><strong class="cart-row-price">${money(priceFor(p)*q)}</strong></div>`;
  }).join(""):`<div class="cart-empty">🛒<br>السلة لسه فاضية<br>اختار المنتجات اللي محتاجها وهتظهر هنا.</div>`;
  $("subtotal").textContent=money(subtotal());
  $("checkoutButton").disabled=ids.length===0;
  $("checkoutItemCount").textContent=cartCount();
  $("checkoutSubtotal").textContent=money(subtotal());
}
function showToast(message){
  $("toast").textContent=message;$("toast").classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.remove("show"),2300);
}
function openCart(){ $("overlay").classList.remove("hidden");$("cartDrawer").classList.add("open");$("cartDrawer").setAttribute("aria-hidden","false"); }
function closeCart(){ $("cartDrawer").classList.remove("open");$("cartDrawer").setAttribute("aria-hidden","true");if($("checkoutModal").classList.contains("hidden"))$("overlay").classList.add("hidden"); }
function openCheckout(){
  if(!cartCount())return;
  closeCart();$("overlay").classList.remove("hidden");$("checkoutModal").classList.remove("hidden");$("prototypeResult").classList.add("hidden");renderCart();
}
function closeCheckout(){ $("checkoutModal").classList.add("hidden");$("overlay").classList.add("hidden"); }
document.addEventListener("click",e=>{
  const add=e.target.closest("[data-add]");
  if(add){cart[add.dataset.add]=(cart[add.dataset.add]||0)+1;renderCart();showToast("اتضاف المنتج للسلة");return}
  const qty=e.target.closest("[data-qty]");
  if(qty){const id=qty.dataset.id;cart[id]=(cart[id]||0)+Number(qty.dataset.qty);if(cart[id]<=0)delete cart[id];renderCart();return}
  const cat=e.target.closest("[data-category]");
  if(cat){selectedCategory=cat.dataset.category;document.querySelectorAll(".category-tab").forEach(b=>b.classList.toggle("active",b===cat));renderProducts()}
});
document.querySelectorAll(".type-btn").forEach(btn=>btn.addEventListener("click",()=>{
  customerType=btn.dataset.type;document.querySelectorAll(".type-btn").forEach(b=>b.classList.toggle("active",b===btn));renderProducts();renderCart();
}));
$("searchInput").addEventListener("input",renderProducts);
$("openCart").addEventListener("click",openCart);
$("closeCart").addEventListener("click",closeCart);
$("continueShopping").addEventListener("click",closeCart);
$("checkoutButton").addEventListener("click",openCheckout);
$("closeCheckout").addEventListener("click",closeCheckout);
$("overlay").addEventListener("click",()=>{closeCart();closeCheckout()});
$("checkoutForm").addEventListener("submit",e=>{
  e.preventDefault();
  const data=Object.fromEntries(new FormData(e.currentTarget).entries());
  const items=Object.entries(cart).map(([id,qty])=>({product:getProduct(id).name,quantity:qty,unit_price:priceFor(getProduct(id)),total:priceFor(getProduct(id))*qty}));
  const summary={customer_type:typeLabels[customerType],customer:data,items,subtotal:subtotal(),note:"معاينة فقط — لم يتم إرسال الطلب أو حفظه في قاعدة البيانات."};
  $("prototypeResult").textContent=`تم تجهيز معاينة الطلب بنجاح.\nالعميل: ${data.customer_name}\nنوع العميل: ${typeLabels[customerType]}\nالمنطقة: ${data.emirate} - ${data.area}\nعدد الأصناف: ${cartCount()}\nالمجموع الفرعي: ${money(subtotal())}\nطريقة الدفع: ${{cash:"نقدًا عند الاستلام",bank_transfer:"تحويل بنكي",by_agreement:"حسب الاتفاق"}[data.payment_method]}\n\nتنبيه: هذه نسخة واجهة تجريبية، لم يتم إرسال بياناتك إلى أي جهة.`;
  $("prototypeResult").classList.remove("hidden");
  showToast("تم تجهيز المعاينة — الطلب لم يُرسل");
});
$("year").textContent=new Date().getFullYear();
renderProducts();renderCart();
