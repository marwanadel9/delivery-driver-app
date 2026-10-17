const products = [
  {id:"carton-700",name:"كرتون 700 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 700 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-700g.jpg",emoji:"🍗",badge:"",price:125,unit:"كرتون"},
  {id:"carton-800",name:"كرتون 800 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 800 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-800g.jpg",emoji:"🍗",badge:"",price:145,unit:"كرتون"},
  {id:"carton-900",name:"كرتون 900 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 900 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-900g.jpg",emoji:"🍗",badge:"",price:160,unit:"كرتون"},
  {id:"carton-1000",name:"كرتون 1000 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1000 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-1000g.jpg",emoji:"🍗",badge:"",price:180,unit:"كرتون"},
  {id:"carton-1100",name:"كرتون 1100 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1100 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-1100g.jpg",emoji:"🍗",badge:"",price:200,unit:"كرتون"},
  {id:"carton-1200",name:"كرتون 1200 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1200 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-1200g.jpg",emoji:"🍗",badge:"",price:215,unit:"كرتون"},
  {id:"carton-1300",name:"كرتون 1300 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1300 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-1300g.jpg",emoji:"🍗",badge:"",price:230,unit:"كرتون"},
  {id:"carton-1400",name:"كرتون 1400 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1400 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-1400g.jpg",emoji:"🍗",badge:"",price:250,unit:"كرتون"},
  {id:"carton-1500",name:"كرتون 1500 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/carton-1500g.jpg",emoji:"🍗",badge:"",price:270,unit:"كرتون"},
  {id:"breast-500",name:"صحن صدور إسبشيل 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن صدور إسبشيل بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-breast.jpg",emoji:"🍖",badge:"",price:25,unit:"صحن"},
  {id:"thighs-500",name:"صحن أفخاذ 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن أفخاذ بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-thighs.jpg",emoji:"🍗",badge:"",price:15,unit:"صحن"},
  {id:"drumsticks-500",name:"صحن أرجل دبوس 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن أرجل دبوس بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-drumsticks.jpg",emoji:"🍗",badge:"",price:15,unit:"صحن"},
  {id:"wings-500",name:"صحن أجنحة 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن أجنحة بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-wings.jpg",emoji:"🍗",badge:"",price:15,unit:"صحن"},
  {id:"liver-500",name:"صحن كبدة 500 جرام",category:"other",categoryName:"منتجات أخرى",desc:"صحن كبدة بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-liver.jpg",emoji:"🥩",badge:"",price:10,unit:"صحن"},
  {id:"gizzards-500",name:"صحن قوانص 500 جرام",category:"other",categoryName:"منتجات أخرى",desc:"صحن قوانص بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-gizzards.jpg",emoji:"🥩",badge:"",price:10,unit:"صحن"},
  {id:"hearts-500",name:"صحن قلوب 500 جرام",category:"other",categoryName:"منتجات أخرى",desc:"صحن قلوب بوزن 500 جرام.",image:"https://wnfibznjxihilgfedfij.supabase.co/storage/v1/object/public/store-images/chicken-hearts.jpg",emoji:"🥩",badge:"",price:10,unit:"صحن"}
];
let selectedCategory = "all";
let cart = {};
let toastTimer;
const $ = id => document.getElementById(id);
const money = value => `${Number(value || 0).toFixed(2)} د.إ`;
function getProduct(id){return products.find(p=>p.id===id)}
function priceFor(product){return product.price}
function visibleProducts(){
  const q = $("searchInput").value.trim().toLowerCase();
  return products.filter(p=>!q||`${p.name} ${p.categoryName} ${p.desc} ${p.unit}`.toLowerCase().includes(q));
}
function productCard(p){
  return `<article class="product-card"><div class="product-visual"><img class="product-photo" src="${p.image}" alt="${p.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'"> <span class="product-emoji" style="display:none">${p.emoji}</span>${p.badge?`<span class="product-badge">${p.badge}</span>`:""}</div><div class="product-body"><span class="product-category">${p.categoryName}</span><h3>${p.name}</h3><p class="product-desc">${p.desc}</p><div class="product-bottom"><div class="product-price">${money(p.price)}<small> / ${p.unit}</small></div><button class="add-button" type="button" data-add="${p.id}" aria-label="أضف ${p.name} للسلة">+</button></div></div></article>`;
}
function renderProducts(){
  const list=visibleProducts();
  const groups=[{category:"chicken",grid:"cartonGrid",empty:"cartonEmpty"},{category:"pieces",grid:"piecesGrid",empty:"piecesEmpty"},{category:"other",grid:"otherGrid",empty:"otherEmpty"}];
  groups.forEach(g=>{
    const items=list.filter(p=>p.category===g.category);
    $(g.grid).innerHTML=items.map(productCard).join("");
    $(g.empty).classList.toggle("hidden",items.length!==0);
  });
}
function cartCount(){return Object.values(cart).reduce((n,q)=>n+q,0)}
function subtotal(){return Object.entries(cart).reduce((sum,[id,q])=>sum+priceFor(getProduct(id))*q,0)}
function deliveryFee(){return subtotal()>0 && subtotal()<200 ? 20 : 0}
function orderTotal(){return subtotal()+deliveryFee()}
function renderCart(){
  $("cartCount").textContent=cartCount();
  const ids=Object.keys(cart).filter(id=>cart[id]>0);
  $("cartItems").innerHTML=ids.length?ids.map(id=>{
    const p=getProduct(id),q=cart[id];
    return `<div class="cart-row"><div class="cart-thumb"><img src="${p.image}" alt="${p.name}" style="width:100%;height:100%;object-fit:contain" onerror="this.style.display='none';this.parentElement.textContent='🍗'"></div><div><h4>${p.name}</h4><small>${money(p.price)} / ${p.unit}</small><div class="qty-control"><button type="button" data-qty="-1" data-id="${id}" aria-label="تقليل">−</button><span>${q}</span><button type="button" data-qty="1" data-id="${id}" aria-label="زيادة">+</button></div></div><strong class="cart-row-price">${money(p.price*q)}</strong></div>`;
  }).join(""):`<div class="cart-empty">🛒<br>السلة لسه فاضية<br>اختار المنتجات اللي محتاجها وهتظهر هنا.</div>`;
  $("subtotal").textContent=money(subtotal());
  if($("deliveryFee")) $("deliveryFee").textContent=deliveryFee()===0 ? "مجانًا" : money(deliveryFee());
  if($("orderTotal")) $("orderTotal").textContent=money(orderTotal());
  if($("cartDeliveryHint")) $("cartDeliveryHint").textContent=subtotal()===0 ? "رسوم التوصيل 20 د.إ للطلبات الأقل من 200 د.إ." : (subtotal()<200 ? "لأن طلبك أقل من 200 د.إ، تُضاف رسوم توصيل 20 د.إ." : "طلبك 200 د.إ أو أكثر؛ التوصيل مجاني.");
  $("checkoutButton").disabled=ids.length===0;
  $("checkoutItemCount").textContent=cartCount();
  $("checkoutSubtotal").textContent=money(subtotal());
  if($("checkoutDeliveryFee")) $("checkoutDeliveryFee").textContent=deliveryFee()===0 ? "مجانًا" : money(deliveryFee());
  if($("checkoutTotal")) $("checkoutTotal").textContent=money(orderTotal());
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
});
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
  $("prototypeResult").textContent=`تم تجهيز معاينة الطلب بنجاح.\nالعميل: ${data.customer_name}\nالمنطقة: ${data.emirate} - ${data.area}\nعدد الأصناف: ${cartCount()}\nالمجموع الفرعي: ${money(subtotal())}\nرسوم التوصيل: ${deliveryFee()===0 ? "مجانًا" : money(deliveryFee())}\nالإجمالي شامل التوصيل: ${money(orderTotal())}\nطريقة الدفع: ${{cash:"نقدًا عند الاستلام",bank_transfer:"تحويل بنكي",by_agreement:"حسب الاتفاق"}[data.payment_method]}\n\nتنبيه: هذه نسخة واجهة تجريبية، لم يتم إرسال بياناتك إلى أي جهة.`;
  $("prototypeResult").classList.remove("hidden");
  showToast("تم تجهيز المعاينة — الطلب لم يُرسل");
});
$("year").textContent=new Date().getFullYear();
renderProducts();renderCart();
