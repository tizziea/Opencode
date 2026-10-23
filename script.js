/* ==========================================================================
   Tiziano E. — Portfolio
   Interacciones: menú mobile, link activo, animaciones y formulario
   ========================================================================== */

(() => {
  "use strict";

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  const header = $(".site-header");
  const nav = $("#nav-menu");
  const navToggle = $(".nav-toggle");
  const navLinks = $$(".nav__link");
  const sections = $$("main section[id]");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const EMAIL = "echilleytizianom@gmail.com";

  /* Año dinámico ---------------------------------------------------------- */
  const year = $("#year");
  if (year) year.textContent = new Date().getFullYear();

  /* Header con fondo al hacer scroll -------------------------------------- */
  const updateHeader = () => {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 10);
  };

  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  /* Menú mobile ----------------------------------------------------------- */
  if (nav && navToggle) {
    const setMenu = (open) => {
      nav.classList.toggle("is-open", open);
      navToggle.setAttribute("aria-expanded", String(open));
      navToggle.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
      document.body.classList.toggle("no-scroll", open);
    };

    const closeMenu = () => setMenu(false);

    navToggle.addEventListener("click", () => {
      setMenu(!nav.classList.contains("is-open"));
    });

    $$("a", nav).forEach((link) => link.addEventListener("click", closeMenu));

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !nav.classList.contains("is-open")) return;
      closeMenu();
      navToggle.focus();
    });

    document.addEventListener("click", (event) => {
      if (!nav.classList.contains("is-open")) return;
      if (nav.contains(event.target) || navToggle.contains(event.target)) return;
      closeMenu();
    });

    window.matchMedia("(min-width: 861px)").addEventListener("change", (event) => {
      if (event.matches) closeMenu();
    });
  }

  /* Link activo según la sección visible ---------------------------------- */
  const headerHeight = header ? header.offsetHeight : 74;
  let activeTicking = false;

  const setActiveLink = () => {
    if (!sections.length || !navLinks.length) return;

    const position = window.scrollY + headerHeight + 120;
    let current = sections[0].id;

    sections.forEach((section) => {
      if (section.offsetTop <= position) current = section.id;
    });

    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 8) {
      current = sections[sections.length - 1].id;
    }

    navLinks.forEach((link) => {
      const isActive = link.getAttribute("href") === `#${current}`;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });

    activeTicking = false;
  };

  const requestActiveUpdate = () => {
    if (activeTicking) return;
    activeTicking = true;
    window.requestAnimationFrame(setActiveLink);
  };

  if (sections.length && navLinks.length) {
    setActiveLink();
    window.addEventListener("scroll", requestActiveUpdate, { passive: true });
    window.addEventListener("resize", requestActiveUpdate);
  }

  /* Animaciones al hacer scroll ------------------------------------------- */
  const revealItems = $$(".reveal");

  if (!prefersReducedMotion && "IntersectionObserver" in window) {
    $$("[data-stagger]").forEach((group) => {
      Array.from(group.children).forEach((child, index) => {
        child.style.setProperty("--reveal-delay", `${index * 90}ms`);
      });
    });

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -60px 0px" });

    revealItems.forEach((item) => observer.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add("is-visible"));
  }
  /* Enlaces de ejemplo: aviso con toast ----------------------------------- */
  const toast = $("#toast");
  let toastTimer;

  const showToast = (message) => {
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 3200);
  };

  $$("[data-placeholder]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showToast("Este enlace es de ejemplo. ¡Pronto habrá novedades!");
    });
  });

  /* Formulario de contacto ------------------------------------------------ */
  const form = $("#contact-form");

  if (form) {
    const submitButton = $("#submit-btn", form);
    const status = $("#form-status", form);

    const fields = {
      nombre: {
        el: $("#nombre", form),
        error: $("#error-nombre", form),
        test: (value) => value.trim().length >= 2 && value.trim().length <= 60,
        message: "Escribí tu nombre (entre 2 y 60 caracteres)."
      },
      email: {
        el: $("#email", form),
        error: $("#error-email", form),
        test: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()),
        message: "Ingresá un email válido, por ejemplo nombre@correo.com."
      },
      mensaje: {
        el: $("#mensaje", form),
        error: $("#error-mensaje", form),
        test: (value) => value.trim().length >= 10 && value.trim().length <= 1200,
        message: "Contame un poco más: al menos 10 caracteres."
      }
    };

    const fieldList = Object.values(fields);

    const setError = (field, message = "") => {
      const wrapper = field.el.closest(".field");
      wrapper.classList.toggle("is-invalid", Boolean(message));
      field.el.setAttribute("aria-invalid", message ? "true" : "false");
      field.error.textContent = message;
    };

    const setStatus = (message, type = "") => {
      if (!status) return;
      status.textContent = message;
      status.className = `form-status${type ? ` is-${type}` : ""}`;
    };

    fieldList.forEach((field) => {
      field.el.addEventListener("input", () => {
        const wrapper = field.el.closest(".field");
        if (!wrapper.classList.contains("is-invalid")) return;
        setError(field, field.test(field.el.value) ? "" : field.message);
      });

      field.el.addEventListener("blur", () => {
        if (!field.el.value.trim()) return;
        setError(field, field.test(field.el.value) ? "" : field.message);
      });
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      setStatus("");

      const honeypot = $("#empresa", form);
      if (honeypot && honeypot.value) return;

      let firstInvalid = null;

      fieldList.forEach((field) => {
        const isValid = field.test(field.el.value);
        setError(field, isValid ? "" : field.message);
        if (!isValid && !firstInvalid) firstInvalid = field.el;
      });

      if (firstInvalid) {
        firstInvalid.focus();
        setStatus("Revisá los campos marcados para continuar.", "error");
        return;
      }

      const nombre = fields.nombre.el.value.trim();
      const email = fields.email.el.value.trim();
      const mensaje = fields.mensaje.el.value.trim();

      const subject = encodeURIComponent(`Consulta de ${nombre} desde tu portfolio`);
      const body = encodeURIComponent(`Hola Tiziano:\n\n${mensaje}\n\n—\n${nombre}\n${email}`);
      const mailto = `mailto:${EMAIL}?subject=${subject}&body=${body}`;

      setStatus("Preparando tu mensaje…");
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.setAttribute("aria-busy", "true");
      }

      window.setTimeout(() => {
        window.location.href = mailto;
        setStatus(
          `Se abrió tu cliente de correo con el mensaje listo. Si no pasó nada, escribime a ${EMAIL}.`,
          "success"
        );
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.removeAttribute("aria-busy");
        }
        form.reset();
      }, 450);
    });
  }
})();
