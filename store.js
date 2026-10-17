const products = [
  {id:"carton-700",name:"كرتون 700 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 700 جرام.",emoji:"🍗",badge:"",price:125,unit:"كرتون"},
  {id:"carton-800",name:"كرتون 800 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 800 جرام.",emoji:"🍗",badge:"",price:145,unit:"كرتون"},
  {id:"carton-900",name:"كرتون 900 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 900 جرام.",emoji:"🍗",badge:"",price:160,unit:"كرتون"},
  {id:"carton-1000",name:"كرتون 1000 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1000 جرام.",emoji:"🍗",badge:"",price:180,unit:"كرتون"},
  {id:"carton-1100",name:"كرتون 1100 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1100 جرام.",emoji:"🍗",badge:"",price:200,unit:"كرتون"},
  {id:"carton-1200",name:"كرتون 1200 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1200 جرام.",emoji:"🍗",badge:"",price:215,unit:"كرتون"},
  {id:"carton-1300",name:"كرتون 1300 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1300 جرام.",emoji:"🍗",badge:"",price:230,unit:"كرتون"},
  {id:"carton-1400",name:"كرتون 1400 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1400 جرام.",emoji:"🍗",badge:"",price:250,unit:"كرتون"},
  {id:"carton-1500",name:"كرتون 1500 جرام",category:"chicken",categoryName:"دجاج كامل",desc:"كرتون فروج بوزن 1500 جرام.",emoji:"🍗",badge:"",price:270,unit:"كرتون"},
  {id:"breast-500",name:"صحن صدور إسبشيل 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن صدور إسبشيل بوزن 500 جرام.",emoji:"🍖",badge:"",price:25,unit:"صحن"},
  {id:"thighs-500",name:"صحن أفخاذ 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن أفخاذ بوزن 500 جرام.",emoji:"🍗",badge:"",price:15,unit:"صحن"},
  {id:"drumsticks-500",name:"صحن أرجل دبوس 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن أرجل دبوس بوزن 500 جرام.",emoji:"🍗",badge:"",price:15,unit:"صحن"},
  {id:"wings-500",name:"صحن أجنحة 500 جرام",category:"pieces",categoryName:"قطع الدجاج",desc:"صحن أجنحة بوزن 500 جرام.",emoji:"🍗",badge:"",price:15,unit:"صحن"},
  {id:"liver-500",name:"صحن كبدة 500 جرام",category:"other",categoryName:"منتجات أخرى",desc:"صحن كبدة بوزن 500 جرام.",emoji:"🥩",badge:"",price:10,unit:"صحن"},
  {id:"gizzards-500",name:"صحن قوانص 500 جرام",category:"other",categoryName:"منتجات أخرى",desc:"صحن قوانص بوزن 500 جرام.",emoji:"🥩",badge:"",price:10,unit:"صحن"},
  {id:"hearts-500",name:"صحن قلوب 500 جرام",category:"other",categoryName:"منتجات أخرى",desc:"صحن قلوب بوزن 500 جرام.",emoji:"🥩",badge:"",price:10,unit:"صحن"}
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
  return products.filter(p=>(selectedCategory==="all"||p.category===selectedCategory)&&(!q||`${p.name} ${p.categoryName} ${p.desc} ${p.unit}`.toLowerCase().includes(q)));
}
function renderProducts(){
  const list=visibleProducts();
  $("productGrid").innerHTML=list.map(p=>`
    <article class="product-card">
      <div class="product-visual"><span class="product-emoji">${p.emoji}</span>${p.badge?`<span class="product-badge">${p.badge}</span>`:""}</div>
      <div class="product-body"><span class="product-category">${p.categoryName}</span><h3>${p.name}</h3><p class="product-desc">${p.desc}</p>
        <div class="product-bottom"><div class="product-price">${money(p.price)}<small> / ${p.unit}</small></div><button class="add-button" type="button" data-add="${p.id}" aria-label="أضف ${p.name} للسلة">+</button></div>
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
    return `<div class="cart-row"><div class="cart-thumb">${p.emoji}</div><div><h4>${p.name}</h4><small>${money(p.price)} / ${p.unit}</small><div class="qty-control"><button type="button" data-qty="-1" data-id="${id}" aria-label="تقليل">−</button><span>${q}</span><button type="button" data-qty="1" data-id="${id}" aria-label="زيادة">+</button></div></div><strong class="cart-row-price">${money(p.price*q)}</strong></div>`;
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
  $("prototypeResult").textContent=`تم تجهيز معاينة الطلب بنجاح.\nالعميل: ${data.customer_name}\nالمنطقة: ${data.emirate} - ${data.area}\nعدد الأصناف: ${cartCount()}\nالمجموع الفرعي: ${money(subtotal())}\nطريقة الدفع: ${{cash:"نقدًا عند الاستلام",bank_transfer:"تحويل بنكي",by_agreement:"حسب الاتفاق"}[data.payment_method]}\n\nتنبيه: هذه نسخة واجهة تجريبية، لم يتم إرسال بياناتك إلى أي جهة.`;
  $("prototypeResult").classList.remove("hidden");
  showToast("تم تجهيز المعاينة — الطلب لم يُرسل");
});
$("year").textContent=new Date().getFullYear();
renderProducts();renderCart();
