import { useState } from "react";
import { signup } from "../services/authService";
import { useSearchParams, useNavigate } from "react-router-dom";

export default function Signup() {

  const [params] = useSearchParams();
  const navigate = useNavigate();

  const role = params.get("role") === "annotator" ? "ANNOTATOR" : "USER";

  const [form, setForm] = useState({});

  const handleSignup = async () => {
    await signup({ ...form, role });
    navigate("/login");
  };

  return (
    <div className="hero">

      <div className="card" style={{padding:"40px", maxWidth:"500px", margin:"auto"}}>

        <h2 style={{marginBottom:"20px"}}>Signup</h2>

        <input
          className="field-input"
          placeholder="Username"
          onChange={(e)=>setForm({...form,username:e.target.value})}
        />

        <br/><br/>

        <input
          className="field-input"
          placeholder="Email"
          onChange={(e)=>setForm({...form,email:e.target.value})}
        />

        <br/><br/>

        <input
          className="field-input"
          type="password"
          placeholder="Password"
          onChange={(e)=>setForm({...form,password:e.target.value})}
        />

        <br/><br/>

        <button
          className="primary-btn"
          onClick={handleSignup}
        >
          Signup as {role}
        </button>

      </div>

    </div>
  );
}